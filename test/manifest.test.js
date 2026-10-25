// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LIMITS } from '../src/config.js';
import { SCENE_ACTIONS, SCENE_TRIGGER_KEYS } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widget.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Every list of form fields the manifest declares (same field grammar).
const allFields = [
  ...manifest.config_schema,
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The store schema is the admission authority: a field type outside this list
// gets the integration rejected by the indexer.
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions ?? []) {
    assert.match(
      indexSource,
      new RegExp(`onAction\\('${action.key}'`),
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('every scene_actions key has a handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  assert.deepEqual([...declared].sort(), Object.keys(SCENE_ACTIONS).sort());
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function', `scene action "${key}" has no handler`);
  }
});

test('every widget has a content and an action handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  assert.deepEqual([...declared].sort(), Object.keys(WIDGETS).sort());
  for (const key of declared) {
    assert.equal(typeof WIDGETS[key].get, 'function');
    assert.equal(typeof WIDGETS[key].action, 'function');
  }
});

test('every scene trigger the code fires is declared, and every declared one is fired', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  for (const field of ['scene_triggers', 'scene_actions', 'widgets']) {
    assert.ok(manifest[field]?.length > 0, `${field} is declared`);
  }
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
});

test('the integration is tagged cloud: Amber is only reachable over the internet', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

// The store vocabulary of the catalog shelves: an unknown key is dropped by
// the indexer with a mere warning, so a typo would silently cost the shelf.
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the catalog shelf is energy, which requires Gladys >= 4.86.0', () => {
  assert.deepEqual(manifest.categories, ['energy']);
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown category "${category}"`);
  }
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]));
});

test('keywords: 1 to 10 unique search terms of 2 to 30 characters', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  for (const keyword of keywords) {
    assert.equal(typeof keyword, 'string');
    const length = keyword.trim().length;
    assert.ok(length >= 2 && length <= 30, `keyword "${keyword}": ${length} characters`);
  }
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords must be unique');
});

test('countries: Amber Electric only sells in Australia', () => {
  assert.deepEqual(manifest.countries, ['AU']);
  for (const country of manifest.countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
});

test('declaring keywords, countries or music requires Gladys >= 5.3.0', () => {
  // An older core rejects the whole manifest over a field it does not know.
  const declared = ['keywords', 'countries', 'music'].filter((field) => field in manifest);
  assert.ok(declared.length > 0);
  assert.ok(isAtLeast(minGladysVersion(), [5, 3, 0]), manifest.gladys_version);
});

test('every user-facing text is written in English, French, German and Spanish', () => {
  const missing = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      if (typeof node.en === 'string') {
        for (const language of LANGUAGES) {
          if (typeof node[language] !== 'string' || node[language].trim() === '') {
            missing.push(`${path}.${language}`);
          }
        }
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(manifest, 'manifest');
  assert.deepEqual(missing, []);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const language of LANGUAGES) {
    const text = manifest.description[language];
    assert.ok(text.length >= 10 && text.length <= 100, `${language}: ${text.length} characters`);
  }
});

test('every field uses a type the store accepts, with sound bounds and options', () => {
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    assert.ok(field.label?.en, `field "${field.key}" needs a label`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type));
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
      assert.ok(field.min < field.max);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `field "${field.key}": source and options`);
    }
    if (field.type === 'select' && field.default !== undefined) {
      assert.ok(field.options.some((option) => option.value === field.default));
    }
    if (field.type === 'number' && field.default !== undefined) {
      assert.ok(field.default >= field.min && field.default <= field.max);
    }
  }
});

test('config_schema defaults and bounds match DEFAULT_CONFIG and LIMITS', () => {
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} is missing from DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
    if (LIMITS[field.key]) {
      assert.deepEqual(LIMITS[field.key], { min: field.min, max: field.max });
    }
  }
});

test('the API token is a secret field', () => {
  const token = manifest.config_schema.find((field) => field.key === 'api_token');
  assert.equal(token.type, 'secret');
  assert.equal(token.required, true);
});

test('section fields are purely presentational, with https links', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-amberelectric:${manifest.version}`);
});
