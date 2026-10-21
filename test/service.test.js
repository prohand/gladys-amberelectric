import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AMBER_ERRORS, AmberApiError } from '../src/amber/client.js';
import { normalizeConfig } from '../src/config.js';
import { SITE_ERRORS, describeError } from '../src/connection.js';
import { FEATURES, siteIds } from '../src/devices/site.js';
import { AmberService, nextRefreshDelay, selectSites } from '../src/service.js';
import { at, fakeClient, pricesAnswer, site } from './helpers/amber.js';

function setup({ client = fakeClient(), config = { api_token: 't' }, now = at(10) } = {}) {
  const gladys = createFakeGladys();
  const clock = { now };
  const created = [];
  const service = new AmberService(gladys, {
    createClient: (options) => {
      created.push(options);
      return client;
    },
    now: () => clock.now,
  });
  service.configure(normalizeConfig(config));
  return { gladys, service, client, clock, created };
}

test('the first refresh publishes the site, its states, its badge and the status', async () => {
  const { gladys, service } = setup();
  await service.refreshAll();
  const ids = siteIds(gladys, site().id);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.GENERAL_PRICE)), 0.2433);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.FEED_IN_PRICE)), 0.085);
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(gladys.fake.widgetRefreshes, ['amber_prices']);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first read only sets the baselines');
});

test('the forecast horizon of the configuration sizes the request', async () => {
  const { service, client } = setup({ config: { api_token: 't', forecast_hours: 6 } });
  await service.refreshAll();
  assert.equal(client.calls.find((c) => c.method === 'getCurrentPrices').options.next, 12);
});

test('an unchanged price is not published twice, a new one is', async () => {
  let general = 24.33;
  const { gladys, service } = setup({
    client: fakeClient({ prices: () => pricesAnswer({ general }) }),
  });
  await service.refreshAll();
  const count = gladys.fake.states.length;
  await service.refreshAll();
  assert.equal(gladys.fake.states.length, count);
  general = 30;
  await service.refreshAll();
  assert.equal(gladys.fake.states.at(-1).state, 0.3);
});

test('a level change between two refreshes fires one scene event', async () => {
  let descriptor = 'neutral';
  const { gladys, service } = setup({
    client: fakeClient({ prices: () => pricesAnswer({ descriptor }) }),
  });
  await service.refreshAll();
  descriptor = 'spike';
  await service.refreshAll();
  await service.refreshAll();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [event.key, event.data.level]),
    [['price_level_changed', 'spike']],
  );
});

test('a refused token turns the status red with a message saying what to do', async () => {
  const client = fakeClient({
    sites: new AmberApiError(AMBER_ERRORS.UNAUTHORIZED, 'refused', { status: 401 }),
  });
  const { gladys, service } = setup({ client });
  await service.refreshAll();
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.deepEqual(status.message, describeError({ code: AMBER_ERRORS.UNAUTHORIZED }));
  // The same failure again is not re-sent.
  await service.refreshAll();
  assert.equal(gladys.fake.connectionStatuses.length, 1);
});

test('a price read that fails marks the site unreachable, and recovers', async () => {
  let fail = true;
  const client = fakeClient({
    prices: () =>
      fail ? new AmberApiError(AMBER_ERRORS.SERVER, 'boom', { status: 502 }) : pricesAnswer(),
  });
  const { gladys, service } = setup({ client });
  await service.refreshAll();
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  fail = false;
  await service.refreshAll();
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a 429 pauses the loop until the window Amber names is over', async () => {
  let limited = true;
  const client = fakeClient({
    prices: () =>
      limited
        ? new AmberApiError(AMBER_ERRORS.RATE_LIMITED, '429', {
            status: 429,
            retryAfterSeconds: 120,
          })
        : pricesAnswer(),
  });
  const { service, clock } = setup({ client });
  await service.refreshAll();
  limited = false;
  const calls = client.calls.length;
  clock.now += 60_000;
  await service.refreshAll();
  assert.equal(client.calls.length, calls, 'still inside the window: no call');
  clock.now += 61_000;
  await service.refreshAll();
  assert.equal(client.calls.length, calls + 1);
});

test('without an active site, the status says so', async () => {
  const { gladys, service } = setup({
    client: fakeClient({ sites: [site({ status: 'pending' })] }),
  });
  await service.refreshAll();
  assert.deepEqual(
    gladys.fake.connectionStatus.message,
    describeError({ code: SITE_ERRORS.NO_SITE }),
  );
});

test('selectSites follows the active sites, or the one named by id or NMI', () => {
  const sites = [
    site({ id: 'A', nmi: '111', status: 'active' }),
    site({ id: 'B', nmi: '222', status: 'closed' }),
    site({ id: 'C', nmi: '333', status: 'pending' }),
  ];
  assert.deepEqual(
    selectSites(sites, '').map((s) => s.id),
    ['A'],
  );
  assert.deepEqual(
    selectSites(sites, 'C').map((s) => s.id),
    ['C'],
  );
  assert.deepEqual(
    selectSites(sites, '222').map((s) => s.id),
    ['B'],
  );
  assert.throws(() => selectSites(sites, 'Z'), { code: SITE_ERRORS.SITE_NOT_FOUND });
});

test('a new token starts from scratch, a new refresh interval does not', async () => {
  const { service, created } = setup();
  await service.refreshAll();
  service.configure(normalizeConfig({ api_token: 't', poll_frequency: 600 }));
  assert.equal(created.length, 1);
  assert.ok(service.snapshotOf(site().id));
  service.configure(normalizeConfig({ api_token: 'other' }));
  assert.equal(created.length, 2);
  assert.equal(created[1].token, 'other');
  assert.equal(service.snapshotOf(site().id), null);
});

test('concurrent refreshes share one run', async () => {
  const { service, client } = setup();
  await Promise.all([service.refreshAll(), service.refreshAll()]);
  assert.equal(client.calls.filter((c) => c.method === 'getCurrentPrices').length, 1);
});

test('refreshes land just after the five-minute marks, never in a burst', () => {
  const base = Date.parse('2026-10-21T03:02:00Z');
  assert.equal(nextRefreshDelay(base, 300), 3 * 60_000 + 15_000); // 03:05:15
  assert.equal(nextRefreshDelay(Date.parse('2026-10-21T03:05:14Z'), 300), 1000);
  assert.equal(nextRefreshDelay(Date.parse('2026-10-21T03:05:15Z'), 300), 300_000);
  assert.equal(nextRefreshDelay(base, 60), 15_000); // 03:02:15
});

test('the loop refreshes at once, then on the interval, and stops cleanly', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, client } = setup();
  const prices = () => client.calls.filter((c) => c.method === 'getCurrentPrices').length;
  // setImmediate is not mocked: it lets the whole refresh run to completion.
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  service.start();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(prices(), 1);
  // The fixtures' clock does not move: the next refresh is one aligned delay away.
  t.mock.timers.tick(nextRefreshDelay(at(10), 300));
  await flush();
  assert.equal(prices(), 2);
  service.stop();
  t.mock.timers.tick(3_600_000);
  await flush();
  assert.equal(prices(), 2);
});
