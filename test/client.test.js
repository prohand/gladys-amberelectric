import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBER_ERRORS, MAX_INTERVALS, createAmberClient } from '../src/amber/client.js';

// A fetch that answers `status` / `body` and records what it was asked.
function fakeFetch(status, body, headers = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      json: async () => body,
    };
  };
  return { fetch, calls };
}

test('the token travels as a Bearer header, never in the URL', async () => {
  const { fetch, calls } = fakeFetch(200, []);
  await createAmberClient({ token: 'psk_secret', fetch }).getSites();
  assert.equal(calls[0].url, 'https://api.amber.com.au/v1/sites');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer psk_secret');
  assert.ok(!calls[0].url.includes('psk_secret'));
});

test('current prices ask for the forecast intervals, within the 2048 Amber allows', async () => {
  const { fetch, calls } = fakeFetch(200, []);
  const client = createAmberClient({ token: 't', fetch });
  await client.getCurrentPrices('site/1', { next: 24 });
  await client.getCurrentPrices('site1', { next: 5000 });
  const first = new URL(calls[0].url);
  assert.equal(first.pathname, '/v1/sites/site%2F1/prices/current');
  assert.equal(first.searchParams.get('next'), '24');
  assert.equal(first.searchParams.get('previous'), '0');
  assert.equal(first.searchParams.has('resolution'), false, 'the billing resolution by default');
  assert.equal(Number(new URL(calls[1].url).searchParams.get('next')), MAX_INTERVALS - 1);
});

test('no token: no call, a clear error', async () => {
  const { fetch, calls } = fakeFetch(200, []);
  await assert.rejects(createAmberClient({ token: '', fetch }).getSites(), {
    code: AMBER_ERRORS.NO_TOKEN,
  });
  assert.equal(calls.length, 0);
});

test('HTTP failures become error codes the user messages are keyed on', async () => {
  const cases = [
    [401, AMBER_ERRORS.UNAUTHORIZED],
    [403, AMBER_ERRORS.UNAUTHORIZED],
    [404, AMBER_ERRORS.NOT_FOUND],
    [429, AMBER_ERRORS.RATE_LIMITED],
    [500, AMBER_ERRORS.SERVER],
    [422, AMBER_ERRORS.BAD_RESPONSE],
  ];
  for (const [status, code] of cases) {
    const { fetch } = fakeFetch(status, {});
    await assert.rejects(createAmberClient({ token: 't', fetch }).getSites(), { code, status });
  }
});

test('a 429 says when to try again, from RateLimit-Reset', async () => {
  const { fetch } = fakeFetch(429, {}, { 'RateLimit-Reset': '137' });
  await assert.rejects(createAmberClient({ token: 't', fetch }).getSites(), {
    code: AMBER_ERRORS.RATE_LIMITED,
    retryAfterSeconds: 137,
  });
});

test('a network failure is reported without the token', async () => {
  const fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(createAmberClient({ token: 'psk_secret', fetch }).getSites(), (err) => {
    assert.equal(err.code, AMBER_ERRORS.NETWORK);
    assert.ok(!err.message.includes('psk_secret'));
    return true;
  });
});

test('an answer that is not a list is refused', async () => {
  const { fetch } = fakeFetch(200, { message: 'nope' });
  const client = createAmberClient({ token: 't', fetch });
  await assert.rejects(client.getSites(), { code: AMBER_ERRORS.BAD_RESPONSE });
  await assert.rejects(client.getCurrentPrices('s'), { code: AMBER_ERRORS.BAD_RESPONSE });
});
