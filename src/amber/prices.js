// -----------------------------------------------------------------------------
// What an Amber price answer means, as pure functions (no I/O, easy to test).
//
// `GET /sites/{id}/prices/current` answers a flat list of intervals: for each
// meter channel (general, controlled load, feed-in), the previous actual
// intervals, the CURRENT interval and the forecast ones. This module turns it
// into one snapshot per site, in the units Gladys shows:
//
//   - prices in $/kWh (Amber speaks c/kWh): the Gladys `dollar` unit, and the
//     unit Amber itself shows in its app;
//   - the feed-in price as what the user EARNS per kWh exported. Amber gives
//     it from the retailer's side, negative when the customer is paid: it is
//     flipped here, so "positive = you are paid, negative = exporting costs
//     you", which is how every user reads it (Home Assistant does the same).
// -----------------------------------------------------------------------------

export const CHANNELS = {
  GENERAL: 'general',
  CONTROLLED_LOAD: 'controlledLoad',
  FEED_IN: 'feedIn',
};

/**
 * Amber's price descriptor, cheapest first. `negative` is no longer sent by
 * Amber (replaced by `extremelyLow`) but older answers may carry it.
 */
export const PRICE_LEVELS = ['extremelyLow', 'veryLow', 'low', 'neutral', 'high', 'spike'];

export const SPIKE_STATUSES = ['none', 'potential', 'spike'];

/** Whether exporting pays (`paid`) or costs (`costly`) right now. */
export const FEED_IN_STATUSES = ['paid', 'costly'];

const INTERVAL_TYPES = {
  ACTUAL: 'ActualInterval',
  CURRENT: 'CurrentInterval',
  FORECAST: 'ForecastInterval',
};

/** c/kWh -> $/kWh, rounded to the tenth of a cent (enough for any display). */
export function centsToDollars(cents) {
  return Math.round(Number(cents) * 100) / 10_000;
}

export function normalizeLevel(descriptor) {
  if (descriptor === 'negative') {
    return 'extremelyLow';
  }
  return PRICE_LEVELS.includes(descriptor) ? descriptor : 'neutral';
}

function normalizeSpike(status) {
  return SPIKE_STATUSES.includes(status) ? status : 'none';
}

export function feedInStatus(earning) {
  return earning < 0 ? 'costly' : 'paid';
}

// The price of an interval in $/kWh, from the user's point of view. A
// forecast carries Amber's own prediction band: `advancedPrice.predicted` is
// the single number Amber advises to plan against, the raw AEMO forecast
// (`perKwh`) only when it is absent.
function userPrice(interval, { preferPredicted = false } = {}) {
  const predicted = interval.advancedPrice?.predicted;
  const cents =
    preferPredicted && Number.isFinite(Number(predicted)) ? Number(predicted) : interval.perKwh;
  const dollars = centsToDollars(cents);
  // `+ 0` turns the -0 of a free feed-in into 0.
  return (interval.channelType === CHANNELS.FEED_IN ? -dollars : dollars) + 0;
}

function spotPrice(interval) {
  return centsToDollars(interval.spotPerKwh);
}

/**
 * The snapshot of one site, from the raw intervals of `prices/current`.
 * @param {object[]} intervals raw Amber intervals
 * @param {Date} [now]
 * @returns {{ fetchedAt: string, channels: object, forecast: object }}
 *   `channels[type]` is the current interval of that channel (absent when the
 *   site has no such channel), `forecast[type]` its upcoming intervals.
 */
export function summarizePrices(intervals, now = new Date()) {
  const channels = {};
  const forecast = {};
  for (const interval of intervals ?? []) {
    const type = interval?.channelType;
    if (!Object.values(CHANNELS).includes(type)) {
      continue;
    }
    if (interval.type === INTERVAL_TYPES.CURRENT) {
      channels[type] = {
        price: userPrice(interval),
        spotPrice: spotPrice(interval),
        level: normalizeLevel(interval.descriptor),
        spikeStatus: normalizeSpike(interval.spikeStatus),
        renewables: Math.round(Number(interval.renewables) * 10) / 10,
        estimate: interval.estimate === true,
        period: interval.tariffInformation?.period ?? null,
        startTime: interval.startTime,
        endTime: interval.endTime,
        duration: Number(interval.duration),
      };
    } else if (interval.type === INTERVAL_TYPES.FORECAST) {
      (forecast[type] ??= []).push({
        price: userPrice(interval, { preferPredicted: true }),
        level: normalizeLevel(interval.descriptor),
        spikeStatus: normalizeSpike(interval.spikeStatus),
        startTime: interval.startTime,
        endTime: interval.endTime,
        duration: Number(interval.duration),
      });
    }
  }
  for (const list of Object.values(forecast)) {
    list.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  }
  return { fetchedAt: now.toISOString(), channels, forecast };
}

/**
 * How many forecast intervals cover `hours`, for an interval length in minutes.
 */
export function intervalsFor(hours, intervalMinutes) {
  const length = [5, 15, 30].includes(Number(intervalMinutes)) ? Number(intervalMinutes) : 30;
  return Math.ceil((hours * 60) / length);
}

/**
 * The cheapest run of consecutive intervals lasting at least `durationMinutes`,
 * starting with the current interval at the earliest and ending within the
 * known forecast.
 *
 * Averaged per interval, which is what a load running at a steady power pays.
 * Ties go to the earliest window: the sooner a dishwasher is done, the better.
 *
 * @param {{ price: number, startTime: string, endTime: string, duration: number }[]} points
 *   the current interval followed by the forecast, in time order
 * @param {number} durationMinutes
 * @param {Date} [now]
 * @returns {{ startTime: string, endTime: string, averagePrice: number, startsInMinutes: number } | null}
 *   null when the forecast is shorter than the duration asked
 */
export function cheapestWindow(points, durationMinutes, now = new Date()) {
  const usable = (points ?? []).filter(
    (point) => Number.isFinite(point?.price) && Number.isFinite(Date.parse(point?.startTime)),
  );
  if (usable.length === 0) {
    return null;
  }
  const step = usable[0].duration > 0 ? usable[0].duration : 30;
  const count = Math.max(1, Math.ceil(durationMinutes / step));
  if (usable.length < count) {
    return null;
  }

  let best = null;
  let sum = usable.slice(0, count).reduce((total, point) => total + point.price, 0);
  for (let start = 0; start + count <= usable.length; start += 1) {
    if (start > 0) {
      sum += usable[start + count - 1].price - usable[start - 1].price;
    }
    if (best === null || sum < best.sum - 1e-9) {
      best = { start, sum };
    }
  }
  const first = usable[best.start];
  const last = usable[best.start + count - 1];
  return {
    startTime: first.startTime,
    endTime: last.endTime,
    averagePrice: Math.round((best.sum / count) * 10_000) / 10_000,
    startsInMinutes: Math.max(
      0,
      Math.round((Date.parse(first.startTime) - now.getTime()) / 60_000),
    ),
  };
}

/**
 * The current interval of a channel followed by its forecast: the time line
 * the widget chart and the cheapest window read.
 */
export function timeline(snapshot, channel = CHANNELS.GENERAL) {
  const current = snapshot?.channels?.[channel];
  const upcoming = snapshot?.forecast?.[channel] ?? [];
  return current ? [current, ...upcoming] : upcoming;
}
