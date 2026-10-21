import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBER_ERRORS } from '../src/amber/client.js';
import { summarizePrices } from '../src/amber/prices.js';
import { SITE_ERRORS, connectionReport, describeError } from '../src/connection.js';
import { LANGUAGES } from '../src/i18n.js';
import { pricesAnswer, site } from './helpers/amber.js';

test('every failure has a message in every language, short enough for a toast', () => {
  for (const code of [...Object.values(AMBER_ERRORS), ...Object.values(SITE_ERRORS)]) {
    const message = describeError({ code });
    for (const language of LANGUAGES) {
      assert.ok(message[language], `${code}.${language}`);
      assert.ok(message[language].length <= 200, `${code}.${language} is too long for a toast`);
    }
  }
});

test('an unknown error still gets a message', () => {
  assert.ok(describeError(new Error('?')).en);
});

test('the connection report lists every site with the id the Site field takes', () => {
  const followed = site();
  const other = site({ id: 'OTHER', nmi: '4000000000', status: 'closed' });
  const report = connectionReport(
    [followed, other],
    new Map([[followed.id, summarizePrices(pricesAnswer())]]),
    new Set([followed.id]),
  );
  assert.deepEqual(Object.keys(report), LANGUAGES);
  assert.match(report.en, /2 site\(s\)/);
  assert.match(report.en, new RegExp(`id ${followed.id} — 0\\.2433 \\$/kWh, Average`));
  assert.match(report.en, /id OTHER \(not followed\)/);
  assert.match(report.fr, /0,2433 \$\/kWh, Moyen/);
  assert.match(report.de, /nicht verfolgt/);
  assert.match(report.es, /no seguido/);
});
