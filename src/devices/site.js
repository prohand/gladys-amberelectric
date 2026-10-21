// -----------------------------------------------------------------------------
// Device type: AMBER SITE
//
// One Gladys device per Amber site (one electricity meter, identified by its
// NMI). Its features are the live prices of the meter's channels and the
// renewable share of the grid — read-only sensors, refreshed by the price
// loop (src/refresh.js), never polled by Gladys: one Amber call per site and
// per refresh serves every feature, the widget and the scene triggers.
//
// External ids are built from the Amber site id, which Amber never changes:
// renaming the site, changing plan or adding solar keeps the same device and
// its history. A channel added later (solar = a feed-in channel) adds a
// feature to the same device.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { CHANNELS } from '../amber/prices.js';

export const SITE_DEVICE_TYPE = 'site';

/** Feature keys: part of the external ids, never renamed. */
export const FEATURES = {
  GENERAL_PRICE: 'general-price',
  SPOT_PRICE: 'spot-price',
  CONTROLLED_LOAD_PRICE: 'controlled-load-price',
  FEED_IN_PRICE: 'feed-in-price',
  RENEWABLES: 'renewables',
};

// $/kWh. The wholesale market is capped around $17.5/kWh and floored at
// -$1/kWh; network fees and GST come on top. Gladys only uses the range to
// draw gauges.
const PRICE_RANGE = { min: -2, max: 25 };

function priceFeature(ids, key, name) {
  return {
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
    type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.DOLLAR,
    ...PRICE_RANGE,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** The channel types (general, controlledLoad, feedIn) a site's meter has. */
export function channelTypesOf(site) {
  return new Set((site?.channels ?? []).map((channel) => channel?.type));
}

export function siteIds(gladys, siteId) {
  return gladys.externalIds(SITE_DEVICE_TYPE, siteId);
}

export function siteDeviceExternalId(gladys, siteId) {
  return siteIds(gladys, siteId).device;
}

/**
 * The discovery payload of one site.
 * @param {object} gladys the SDK instance
 * @param {{ id: string, nmi: string, channels: object[] }} site an Amber site
 */
export function buildSiteDevice(gladys, site) {
  const ids = siteIds(gladys, site.id);
  const channels = channelTypesOf(site);
  // Every site buys from the grid: the general price is always there, even
  // when Amber lists no channel (a pending site).
  const features = [
    priceFeature(ids, FEATURES.GENERAL_PRICE, 'Electricity price'),
    priceFeature(ids, FEATURES.SPOT_PRICE, 'Wholesale spot price'),
  ];
  if (channels.has(CHANNELS.CONTROLLED_LOAD)) {
    features.push(priceFeature(ids, FEATURES.CONTROLLED_LOAD_PRICE, 'Controlled load price'));
  }
  if (channels.has(CHANNELS.FEED_IN)) {
    features.push(priceFeature(ids, FEATURES.FEED_IN_PRICE, 'Feed-in price'));
  }
  features.push({
    name: 'Renewables in the grid',
    external_id: ids.feature(FEATURES.RENEWABLES),
    category: DEVICE_FEATURE_CATEGORIES.GRID_CARBON_SENSOR,
    type: DEVICE_FEATURE_TYPES.GRID_CARBON_SENSOR.RENEWABLE_PERCENTAGE,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 100,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });

  return {
    name: `Amber Electric ${site.nmi ?? site.id}`,
    external_id: ids.device,
    // No `should_poll`: the price loop refreshes every site at the interval
    // of the configuration, with one call per site.
    features,
  };
}

/**
 * The states of one site, from its price snapshot (see summarizePrices).
 * Only the features the site has, and only the values Amber gave.
 */
export function siteStates(gladys, site, snapshot) {
  const ids = siteIds(gladys, site.id);
  const featureIds = new Set(buildSiteDevice(gladys, site).features.map((f) => f.external_id));
  const general = snapshot?.channels?.[CHANNELS.GENERAL];
  const candidates = [
    [FEATURES.GENERAL_PRICE, general?.price],
    [FEATURES.SPOT_PRICE, general?.spotPrice],
    [FEATURES.CONTROLLED_LOAD_PRICE, snapshot?.channels?.[CHANNELS.CONTROLLED_LOAD]?.price],
    [FEATURES.FEED_IN_PRICE, snapshot?.channels?.[CHANNELS.FEED_IN]?.price],
    [FEATURES.RENEWABLES, general?.renewables],
  ];
  return candidates
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }))
    .filter(
      ({ device_feature_external_id: id, state }) =>
        featureIds.has(id) && typeof state === 'number' && Number.isFinite(state),
    );
}
