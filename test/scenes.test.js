import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { summarizePrices } from '../src/amber/prices.js';
import {
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  baselineOf,
  publishSceneEvents,
  sceneEventsFor,
} from '../src/capabilities/scenes.js';
import { normalizeConfig } from '../src/config.js';
import { siteDeviceExternalId } from '../src/devices/site.js';
import { AmberService } from '../src/service.js';
import { at, fakeClient, pricesAnswer, site } from './helpers/amber.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const snap = (options) => summarizePrices(pricesAnswer(options));
const DEVICE = 'ext:test-integration:site:x';

test('the first read only sets the baseline: a restart replays nothing', () => {
  assert.deepEqual(sceneEventsFor(DEVICE, undefined, snap({ descriptor: 'spike' })), []);
});

test('a refresh with nothing new fires nothing', () => {
  const snapshot = snap();
  assert.deepEqual(sceneEventsFor(DEVICE, baselineOf(snapshot), snapshot), []);
});

test('a level change fires price_level_changed, once', () => {
  const before = baselineOf(snap({ descriptor: 'neutral' }));
  const events = sceneEventsFor(DEVICE, before, snap({ descriptor: 'veryLow', general: 5 }));
  assert.deepEqual(events, [
    {
      key: SCENE_TRIGGERS.PRICE_LEVEL_CHANGED,
      data: { device: DEVICE, level: 'veryLow', previous_level: 'neutral', price: 0.05 },
    },
  ]);
});

test('a spike and a feed-in crossing zero fire their own triggers', () => {
  const before = baselineOf(snap({ spikeStatus: 'none', feedIn: -5 }));
  const events = sceneEventsFor(DEVICE, before, snap({ spikeStatus: 'potential', feedIn: 2 }));
  assert.deepEqual(
    events.map((event) => [event.key, event.data.status, event.data.previous_status]),
    [
      [SCENE_TRIGGERS.SPIKE_STATUS_CHANGED, 'potential', 'none'],
      [SCENE_TRIGGERS.FEED_IN_STATUS_CHANGED, 'costly', 'paid'],
    ],
  );
  assert.equal(events[1].data.price, -0.02);
});

test('every event only carries keys its trigger declares, with filter values it offers', () => {
  const before = baselineOf(snap({ spikeStatus: 'none', feedIn: -5, descriptor: 'neutral' }));
  const events = sceneEventsFor(
    DEVICE,
    before,
    snap({ spikeStatus: 'spike', feedIn: 2, descriptor: 'spike' }),
  );
  assert.equal(events.length, 3);
  for (const { key, data } of events) {
    const trigger = declarationOf('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [name, value] of Object.entries(data)) {
      assert.ok(declared.includes(name), `${key}: data.${name} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${name} not primitive`);
    }
    for (const field of trigger.fields.filter((f) => f.type === 'multi_select')) {
      assert.ok(
        field.options.some((option) => option.value === data[field.key]),
        `${key}: "${data[field.key]}" is not an option of ${field.key}`,
      );
    }
  }
});

test('a refused event is logged, never thrown', async () => {
  const gladys = createFakeGladys();
  gladys.publishSceneEvent = async () => {
    throw new Error('429');
  };
  await publishSceneEvents(gladys, [{ key: 'price_level_changed', data: {} }]);
});

async function serviceWith(prices) {
  const gladys = createFakeGladys();
  const client = fakeClient({ prices });
  const service = new AmberService(gladys, { createClient: () => client, now: () => at(10) });
  service.configure(normalizeConfig({ api_token: 't' }));
  await service.refreshAll();
  return { gladys, service, client, device: siteDeviceExternalId(gladys, site().id) };
}

function assertDeclaredOutputs(key, outputs) {
  const declared = keysOf(declarationOf('scene_actions', key).outputs);
  assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort());
  for (const value of Object.values(outputs)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value), 'outputs are scalars');
  }
}

test('get_current_price returns the declared outputs from the last refresh', async () => {
  const { gladys, service, client, device } = await serviceWith(pricesAnswer());
  const calls = client.calls.length;
  const outputs = await SCENE_ACTIONS.get_current_price(gladys, { fields: { device }, service });
  assertDeclaredOutputs('get_current_price', outputs);
  assert.equal(outputs.available, true);
  assert.equal(outputs.price, 0.2433);
  assert.equal(outputs.level, 'neutral');
  assert.equal(outputs.period, 'peak');
  assert.equal(client.calls.length, calls, 'a recent refresh is reused: no Amber call');

  const feedIn = await SCENE_ACTIONS.get_current_price(gladys, {
    fields: { device, channel: 'feedIn' },
    service,
  });
  assert.equal(feedIn.price, 0.085);
});

test('get_current_price reports a channel the site lacks through its output', async () => {
  const { gladys, service, device } = await serviceWith(pricesAnswer());
  const outputs = await SCENE_ACTIONS.get_current_price(gladys, {
    fields: { device, channel: 'controlledLoad' },
    service,
  });
  assertDeclaredOutputs('get_current_price', outputs);
  assert.equal(outputs.available, false);
});

test('a scene action on a device that is not an Amber site fails', async () => {
  const { gladys, service } = await serviceWith(pricesAnswer());
  await assert.rejects(
    SCENE_ACTIONS.get_current_price(gladys, { fields: { device: 'ext:other:x' }, service }),
    /Not an Amber site/,
  );
});

test('find_cheapest_window answers when to run, and fires no scene event', async () => {
  const { gladys, service, device } = await serviceWith(
    pricesAnswer({ general: 25, forecast: [20, 15, 10, 12, 30] }),
  );
  const outputs = await SCENE_ACTIONS.find_cheapest_window(gladys, {
    fields: { device, duration_minutes: 60, within_hours: 12 },
    service,
  });
  assertDeclaredOutputs('find_cheapest_window', outputs);
  assert.equal(outputs.found, true);
  assert.equal(outputs.average_price, 0.11);
  assert.equal(outputs.start_time, '2026-10-21T01:30:00.000Z');
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('find_cheapest_window says found: false when the forecast is too short', async () => {
  const { gladys, service, device } = await serviceWith(pricesAnswer({ forecast: [10] }));
  const outputs = await SCENE_ACTIONS.find_cheapest_window(gladys, {
    fields: { device, duration_minutes: 240 },
    service,
  });
  assertDeclaredOutputs('find_cheapest_window', outputs);
  assert.equal(outputs.found, false);
});

test('find_cheapest_window reads a longer forecast than the loop keeps', async () => {
  const { gladys, service, client, device } = await serviceWith(pricesAnswer());
  const calls = client.calls.length;
  await SCENE_ACTIONS.find_cheapest_window(gladys, {
    fields: { device, duration_minutes: 60, within_hours: 24 },
    service,
  });
  assert.equal(client.calls.length, calls + 1);
  assert.equal(client.calls.at(-1).options.next, 48);
});
