import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, applyLogLevel, normalizeConfig } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('the token and the site are trimmed: a pasted newline is not a 401', () => {
  const config = normalizeConfig({ api_token: '  psk_abc\n', site_id: ' 01ABC ' });
  assert.equal(config.api_token, 'psk_abc');
  assert.equal(config.site_id, '01ABC');
});

test('numbers typed as strings are read, and kept within the manifest bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: '120' }).poll_frequency, 120);
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 300);
  assert.equal(normalizeConfig({ forecast_hours: 100 }).forecast_hours, 48);
  assert.equal(normalizeConfig({ forecast_hours: 0 }).forecast_hours, 1);
});

test('the detailed logs switch raises LOG_LEVEL and puts it back', () => {
  const before = process.env.LOG_LEVEL;
  try {
    assert.equal(applyLogLevel(normalizeConfig({ debug_logs: true })), 'debug');
    assert.equal(process.env.LOG_LEVEL, 'debug');
    applyLogLevel(normalizeConfig({ debug_logs: false }));
    assert.equal(process.env.LOG_LEVEL, before);
  } finally {
    if (before === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = before;
    }
  }
});
