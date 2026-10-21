// The release commit is pushed straight to main by the Release workflow: what
// .github/scripts/changelog-release.mjs writes must be right the first time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('the changelog has an Unreleased section for the next release', () => {
  assert.match(changelog, /^## \[Unreleased\]$/m);
});

test('a release moves Unreleased under the version and links its tag', () => {
  const rolled = rollChangelog(changelog, '1.0.1', '2026-10-21');
  assert.match(rolled, /^## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-10-21\n/m);
  assert.match(
    rolled,
    /^\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-amberelectric\/compare\/v1\.0\.1\.\.\.HEAD$/m,
  );
  assert.match(
    rolled,
    /^\[1\.0\.1\]: https:\/\/github\.com\/prohand\/gladys-amberelectric\/releases\/tag\/v1\.0\.1$/m,
  );
});
