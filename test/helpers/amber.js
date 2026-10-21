// -----------------------------------------------------------------------------
// Amber stand-ins for the tests: sites and price answers shaped like the real
// API (see https://app.amber.com.au/swagger.json), and a client that serves
// them without the network.
// -----------------------------------------------------------------------------

export const SITE_ID = '01F5A5CRKMZ5BCX9P1S4V990AM';

export function site(overrides = {}) {
  return {
    id: SITE_ID,
    nmi: '3052282872',
    channels: [
      { identifier: 'E1', type: 'general', tariff: 'A100' },
      { identifier: 'B1', type: 'feedIn', tariff: 'A100' },
    ],
    network: 'Jemena',
    status: 'active',
    activeFrom: '2022-01-01',
    intervalLength: 30,
    ...overrides,
  };
}

const START = Date.parse('2026-10-21T00:00:00Z');

/**
 * One raw Amber interval.
 * @param {object} options
 */
export function interval({
  type = 'CurrentInterval',
  channelType = 'general',
  index = 0,
  perKwh = 24.33,
  spotPerKwh = 6.12,
  descriptor = 'neutral',
  spikeStatus = 'none',
  renewables = 45.6,
  duration = 30,
  advancedPrice,
  period,
} = {}) {
  const startTime = new Date(START + index * duration * 60_000).toISOString();
  const endTime = new Date(START + (index + 1) * duration * 60_000).toISOString();
  return {
    type,
    duration,
    spotPerKwh,
    perKwh,
    date: startTime.slice(0, 10),
    nemTime: endTime,
    startTime,
    endTime,
    renewables,
    channelType,
    spikeStatus,
    descriptor,
    ...(type === 'CurrentInterval' ? { estimate: true } : {}),
    ...(advancedPrice ? { advancedPrice } : {}),
    ...(period ? { tariffInformation: { period } } : {}),
  };
}

/**
 * A `prices/current` answer: the current interval of the general and feed-in
 * channels, then `forecast` general prices (c/kWh) one interval apart.
 */
export function pricesAnswer({
  general = 24.33,
  feedIn = -8.5,
  descriptor = 'neutral',
  spikeStatus = 'none',
  forecast = [20, 15, 10, 12, 30],
} = {}) {
  return [
    interval({ perKwh: general, descriptor, spikeStatus, period: 'peak' }),
    ...forecast.map((perKwh, i) =>
      interval({ type: 'ForecastInterval', index: i + 1, perKwh, descriptor: 'low' }),
    ),
    interval({ channelType: 'feedIn', perKwh: feedIn, descriptor }),
  ];
}

/** The instant of the current interval of the fixtures, plus `minutes`. */
export function at(minutes = 10) {
  return START + minutes * 60_000;
}

/**
 * A client serving fixed answers; `answers.prices` may be a function called on
 * each read, or an Error to throw.
 */
export function fakeClient({ sites = [site()], prices = pricesAnswer() } = {}) {
  const calls = [];
  const serve = (value) => {
    const resolved = typeof value === 'function' ? value(calls.length) : value;
    if (resolved instanceof Error) {
      throw resolved;
    }
    return resolved;
  };
  return {
    calls,
    async getSites() {
      calls.push({ method: 'getSites' });
      return serve(sites);
    },
    async getCurrentPrices(siteId, options) {
      calls.push({ method: 'getCurrentPrices', siteId, options });
      return serve(prices);
    },
  };
}
