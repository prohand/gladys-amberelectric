// The user documentation exists in every language of the interface, and the
// four files keep the same outline: a section added in one is added in all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/i18n.js';

const outline = async (language) =>
  (await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8'))
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0]);

test('docs/<language>.md exist with the same outline', async () => {
  const reference = await outline('en');
  assert.ok(reference.length > 3);
  for (const language of LANGUAGES) {
    assert.deepEqual(await outline(language), reference, `docs/${language}.md outline`);
  }
});
