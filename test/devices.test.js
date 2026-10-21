import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { summarizePrices } from '../src/amber/prices.js';
import { FEATURES, buildSiteDevice, siteIds, siteStates } from '../src/devices/site.js';
import { pricesAnswer, site } from './helpers/amber.js';

const featureKeys = (gladys, device, s) =>
  device.features.map((feature) =>
    feature.external_id.replace(`${siteIds(gladys, s.id).device}:`, ''),
  );

test('a site with solar gets a feed-in price, Gladys takes the device', async () => {
  const gladys = createFakeGladys();
  const device = buildSiteDevice(gladys, site());
  assert.deepEqual(featureKeys(gladys, device, site()), [
    FEATURES.GENERAL_PRICE,
    FEATURES.SPOT_PRICE,
    FEATURES.FEED_IN_PRICE,
    FEATURES.RENEWABLES,
  ]);
  assert.equal(device.name, 'Amber Electric 3052282872');
  // The fake refuses what Gladys refuses: unknown category, type, unit.
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('the features exist only for the channels the meter has', () => {
  const gladys = createFakeGladys();
  const plain = site({ channels: [{ identifier: 'E1', type: 'general', tariff: 'A' }] });
  assert.deepEqual(featureKeys(gladys, buildSiteDevice(gladys, plain), plain), [
    FEATURES.GENERAL_PRICE,
    FEATURES.SPOT_PRICE,
    FEATURES.RENEWABLES,
  ]);
  const hotWater = site({
    channels: [
      { identifier: 'E1', type: 'general', tariff: 'A' },
      { identifier: 'E2', type: 'controlledLoad', tariff: 'A' },
    ],
  });
  assert.ok(
    featureKeys(gladys, buildSiteDevice(gladys, hotWater), hotWater).includes(
      FEATURES.CONTROLLED_LOAD_PRICE,
    ),
  );
});

test('the external ids come from the Amber site id, not from the NMI or a name', () => {
  const gladys = createFakeGladys();
  const a = buildSiteDevice(gladys, site({ nmi: '1111111111' }));
  const b = buildSiteDevice(gladys, site({ nmi: '2222222222' }));
  assert.equal(a.external_id, b.external_id);
  assert.notEqual(a.name, b.name);
});

test('every feature is a read-only sensor with a range', () => {
  const gladys = createFakeGladys();
  for (const feature of buildSiteDevice(gladys, site()).features) {
    assert.equal(feature.read_only, true);
    assert.equal(typeof feature.min, 'number');
    assert.equal(typeof feature.max, 'number');
    assert.ok(feature.min < feature.max);
  }
});

test('the states follow the snapshot, and Gladys takes them', async () => {
  const gladys = createFakeGladys();
  const s = site();
  const states = siteStates(gladys, s, summarizePrices(pricesAnswer()));
  const ids = siteIds(gladys, s.id);
  assert.deepEqual(
    Object.fromEntries(states.map((st) => [st.device_feature_external_id, st.state])),
    {
      [ids.feature(FEATURES.GENERAL_PRICE)]: 0.2433,
      [ids.feature(FEATURES.SPOT_PRICE)]: 0.0612,
      [ids.feature(FEATURES.FEED_IN_PRICE)]: 0.085,
      [ids.feature(FEATURES.RENEWABLES)]: 45.6,
    },
  );
  await gladys.publishStates(states);
});

test('a channel Amber did not answer for publishes nothing', () => {
  const gladys = createFakeGladys();
  const states = siteStates(gladys, site(), summarizePrices([]));
  assert.deepEqual(states, []);
});
