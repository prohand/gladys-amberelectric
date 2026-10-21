// -----------------------------------------------------------------------------
// Scene triggers and scene actions (SDK v0.14+, Gladys 5.1+).
//
// TRIGGERS — what HAPPENED to the price, declared in the manifest
// `scene_triggers`:
//
//   price_level_changed     Amber's price level moved (very low, high, spike…):
//                           "run the pool pump while the price is low".
//   spike_status_changed    a price spike became possible, started or ended:
//                           "pre-cool the house before the spike".
//   feed_in_status_changed  exporting solar started to cost money, or paid
//                           again: "curtail the inverter while it costs".
//
// The price itself stays a device feature (a state): "price above 30 c" is a
// standard device trigger of Gladys. The events here carry what a number
// cannot — a level, a status — and fire once per TRANSITION, never on every
// refresh: the first read after a start only sets the baseline, so a restart
// of the integration never replays them.
//
// ACTIONS — operations a scene author places in a scene, declared in the
// manifest `scene_actions`:
//
//   get_current_price       the current price of a channel, with its level,
//                           spike status and renewable share, as outputs the
//                           following actions read ({{...}}) or test.
//   find_cheapest_window    when, in the next hours, a load of a given length
//                           is cheapest: "start the dishwasher in N minutes".
//
// Scene actions never fire a scene event (a scene bound to it would loop
// through the integration): they read the snapshot of the last refresh, or
// fetch a fresh one that does not move the trigger baselines.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CHANNELS, cheapestWindow, feedInStatus, timeline } from '../amber/prices.js';

const logger = createLogger({ name: 'scenes' });

/** Keys of the manifest `scene_triggers`. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  PRICE_LEVEL_CHANGED: 'price_level_changed',
  SPIKE_STATUS_CHANGED: 'spike_status_changed',
  FEED_IN_STATUS_CHANGED: 'feed_in_status_changed',
};

/**
 * What the triggers compare from one refresh to the next.
 * @param {object} snapshot see summarizePrices
 */
export function baselineOf(snapshot) {
  const general = snapshot?.channels?.[CHANNELS.GENERAL];
  const feedIn = snapshot?.channels?.[CHANNELS.FEED_IN];
  return {
    level: general?.level ?? null,
    spikeStatus: general?.spikeStatus ?? null,
    feedInStatus: feedIn ? feedInStatus(feedIn.price) : null,
  };
}

/**
 * The scene events one refresh produces: one per value that changed since
 * the previous refresh of the same site. Pure, so the tests can walk through
 * a whole day of prices.
 *
 * @param {string} device the site's device external_id (the `device` filter)
 * @param {object | undefined} previous baselineOf the previous snapshot, or
 *   undefined on the first read (no event: nothing to compare with)
 * @param {object} snapshot the new snapshot
 * @returns {{ key: string, data: object }[]}
 */
export function sceneEventsFor(device, previous, snapshot) {
  if (!previous) {
    return [];
  }
  const next = baselineOf(snapshot);
  const general = snapshot?.channels?.[CHANNELS.GENERAL];
  const feedIn = snapshot?.channels?.[CHANNELS.FEED_IN];
  const events = [];

  if (next.level && previous.level && next.level !== previous.level) {
    events.push({
      key: SCENE_TRIGGERS.PRICE_LEVEL_CHANGED,
      data: { device, level: next.level, previous_level: previous.level, price: general.price },
    });
  }
  if (next.spikeStatus && previous.spikeStatus && next.spikeStatus !== previous.spikeStatus) {
    events.push({
      key: SCENE_TRIGGERS.SPIKE_STATUS_CHANGED,
      data: {
        device,
        status: next.spikeStatus,
        previous_status: previous.spikeStatus,
        price: general.price,
      },
    });
  }
  if (next.feedInStatus && previous.feedInStatus && next.feedInStatus !== previous.feedInStatus) {
    events.push({
      key: SCENE_TRIGGERS.FEED_IN_STATUS_CHANGED,
      data: {
        device,
        status: next.feedInStatus,
        previous_status: previous.feedInStatus,
        price: feedIn.price,
      },
    });
  }
  return events;
}

/**
 * Fire the events. Never throws: a refused event (429, a Gladys too old to
 * know the trigger) must not cost the refresh its states.
 */
export async function publishSceneEvents(gladys, events) {
  for (const { key, data } of events) {
    try {
      logger.info(
        `Scene event ${key}: ${data.previous_level ?? data.previous_status} -> ${data.level ?? data.status}`,
      );
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused by Gladys: ${err.message}`);
    }
  }
}

/** Every trigger key the code fires (checked against the manifest by the tests). */
export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGERS);

// Outputs of get_current_price when the site has no such channel: the scene
// gates on `available`, a scene action is never a condition.
const UNAVAILABLE_PRICE = {
  available: false,
  price: 0,
  spot_price: 0,
  level: '',
  spike_status: '',
  renewables: 0,
  estimate: false,
  period: '',
};

export const SCENE_ACTIONS = {
  async get_current_price(gladys, { fields, service }) {
    const site = await service.siteByDevice(fields.device);
    const channel = Object.values(CHANNELS).includes(fields.channel)
      ? fields.channel
      : CHANNELS.GENERAL;
    logger.info(`Scene action get_current_price <- ${fields.device} (${channel})`);
    const snapshot = await service.readSnapshot(site);
    const current = snapshot.channels[channel];
    if (!current) {
      return UNAVAILABLE_PRICE;
    }
    const general = snapshot.channels[CHANNELS.GENERAL];
    return {
      available: true,
      price: current.price,
      spot_price: current.spotPrice,
      level: current.level,
      spike_status: current.spikeStatus,
      renewables: general?.renewables ?? current.renewables,
      estimate: current.estimate,
      period: current.period ?? '',
    };
  },

  async find_cheapest_window(gladys, { fields, service }) {
    const site = await service.siteByDevice(fields.device);
    const duration = Math.max(5, Number(fields.duration_minutes) || 60);
    const withinHours = Math.min(48, Math.max(1, Number(fields.within_hours) || 12));
    logger.info(
      `Scene action find_cheapest_window <- ${fields.device} (${duration} min within ${withinHours} h)`,
    );
    const snapshot = await service.readSnapshot(site, { forecastHours: withinHours });
    const now = new Date();
    const horizon = now.getTime() + withinHours * 3_600_000;
    const points = timeline(snapshot, CHANNELS.GENERAL).filter(
      (point) => Date.parse(point.endTime) <= horizon + 60_000,
    );
    const window = cheapestWindow(points, duration, now);
    if (!window) {
      return {
        found: false,
        start_time: '',
        end_time: '',
        average_price: 0,
        starts_in_minutes: 0,
      };
    }
    return {
      found: true,
      start_time: window.startTime,
      end_time: window.endTime,
      average_price: window.averagePrice,
      starts_in_minutes: window.startsInMinutes,
    };
  },
};
