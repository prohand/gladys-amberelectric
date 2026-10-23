// The release commit is pushed straight to main by the Release workflow: what
// .github/scripts/changelog-release.mjs writes must be right the first time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const REPO = 'https://github\\.com/prohand/gladys-amberelectric';
const { version: current } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
// The release after the current one, whatever the current one is.
const next = current.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const escape = (version) => version.replaceAll('.', '\\.');

test('the changelog has an Unreleased section for the next release', () => {
  assert.match(changelog, /^## \[Unreleased\]$/m);
});

test('a release moves Unreleased under the version and links its tag', () => {
  const rolled = rollChangelog(changelog, next, '2026-10-21');
  assert.match(
    rolled,
    new RegExp(`^## \\[Unreleased\\]\\n\\n## \\[${escape(next)}\\] - 2026-10-21\\n`, 'm'),
  );
  assert.match(
    rolled,
    new RegExp(`^\\[Unreleased\\]: ${REPO}/compare/v${escape(next)}\\.\\.\\.HEAD$`, 'm'),
  );
  assert.match(
    rolled,
    new RegExp(
      `^\\[${escape(next)}\\]: ${REPO}/compare/v${escape(current)}\\.\\.\\.v${escape(next)}$`,
      'm',
    ),
  );
});
