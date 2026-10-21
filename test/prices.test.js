import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS,
  centsToDollars,
  cheapestWindow,
  feedInStatus,
  intervalsFor,
  normalizeLevel,
  summarizePrices,
  timeline,
} from '../src/amber/prices.js';
import { at, interval, pricesAnswer } from './helpers/amber.js';

test('prices are converted from c/kWh to $/kWh', () => {
  assert.equal(centsToDollars(24.33), 0.2433);
  assert.equal(centsToDollars(-1.5), -0.015);
  assert.equal(centsToDollars(1750.123), 17.5012);
});

test('the snapshot holds the current interval of each channel', () => {
  const snapshot = summarizePrices(pricesAnswer(), new Date(at()));
  const general = snapshot.channels[CHANNELS.GENERAL];
  assert.equal(general.price, 0.2433);
  assert.equal(general.spotPrice, 0.0612);
  assert.equal(general.level, 'neutral');
  assert.equal(general.spikeStatus, 'none');
  assert.equal(general.renewables, 45.6);
  assert.equal(general.estimate, true);
  assert.equal(general.period, 'peak');
  assert.equal(snapshot.channels[CHANNELS.CONTROLLED_LOAD], undefined);
});

test('the feed-in price is what the user earns: Amber sign flipped', () => {
  // Amber: -8.5 c/kWh on feed-in = the customer is PAID 8.5 c per kWh exported.
  const paid = summarizePrices(pricesAnswer({ feedIn: -8.5 })).channels.feedIn;
  assert.equal(paid.price, 0.085);
  assert.equal(feedInStatus(paid.price), 'paid');
  const costly = summarizePrices(pricesAnswer({ feedIn: 3 })).channels.feedIn;
  assert.equal(costly.price, -0.03);
  assert.equal(feedInStatus(costly.price), 'costly');
  assert.ok(!Object.is(summarizePrices(pricesAnswer({ feedIn: 0 })).channels.feedIn.price, -0));
});

test('forecasts use the price Amber predicts, sorted in time', () => {
  const answer = [
    interval({ type: 'ForecastInterval', index: 2, perKwh: 30 }),
    interval({
      type: 'ForecastInterval',
      index: 1,
      perKwh: 50,
      advancedPrice: { low: 10, predicted: 20, high: 90 },
    }),
  ];
  const forecast = summarizePrices(answer).forecast.general;
  assert.deepEqual(
    forecast.map((point) => point.price),
    [0.2, 0.3],
  );
});

test('actual intervals and unknown channels are ignored', () => {
  const snapshot = summarizePrices([
    interval({ type: 'ActualInterval', index: -1 }),
    interval({ channelType: 'gas' }),
  ]);
  assert.deepEqual(snapshot.channels, {});
  assert.deepEqual(snapshot.forecast, {});
});

test('the retired "negative" level reads as extremely low, an unknown one as average', () => {
  assert.equal(normalizeLevel('negative'), 'extremelyLow');
  assert.equal(normalizeLevel('veryLow'), 'veryLow');
  assert.equal(normalizeLevel('whatever'), 'neutral');
});

test('intervalsFor counts the forecast intervals of a horizon', () => {
  assert.equal(intervalsFor(12, 30), 24);
  assert.equal(intervalsFor(12, 5), 144);
  assert.equal(intervalsFor(1, undefined), 2, 'an unknown length counts as 30 minutes');
});

test('the cheapest window is the lowest average run of intervals', () => {
  const snapshot = summarizePrices(pricesAnswer({ general: 25, forecast: [20, 15, 10, 12, 30] }));
  const points = timeline(snapshot);
  const oneHour = cheapestWindow(points, 60, new Date(at(10)));
  // 10 + 12 c/kWh, intervals 3 and 4 (the current one is 0).
  assert.equal(oneHour.averagePrice, 0.11);
  assert.equal(oneHour.startTime, points[3].startTime);
  assert.equal(oneHour.endTime, points[4].endTime);
  assert.equal(oneHour.startsInMinutes, 80);

  const now = cheapestWindow(points, 30, new Date(at(10)));
  assert.equal(now.averagePrice, 0.1);

  const all = cheapestWindow(points, 180, new Date(at(10)));
  assert.equal(all.startsInMinutes, 0, 'a window starting with the current interval starts now');
});

test('no cheapest window when the forecast is too short', () => {
  const points = timeline(summarizePrices(pricesAnswer({ forecast: [10] })));
  assert.equal(cheapestWindow(points, 120), null);
  assert.equal(cheapestWindow([], 30), null);
});

test('ties go to the earliest window', () => {
  const points = timeline(summarizePrices(pricesAnswer({ general: 10, forecast: [10, 10] })));
  assert.equal(cheapestWindow(points, 30).startTime, points[0].startTime);
});
