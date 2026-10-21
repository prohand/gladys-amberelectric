import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AMBER_ERRORS, AmberApiError } from '../src/amber/client.js';
import { PRICES_WIDGET, WIDGETS, refreshWidgets, toCents } from '../src/capabilities/widget.js';
import { normalizeConfig } from '../src/config.js';
import { siteDeviceExternalId } from '../src/devices/site.js';
import { AmberService } from '../src/service.js';
import { at, fakeClient, pricesAnswer, site } from './helpers/amber.js';

const widget = WIDGETS[PRICES_WIDGET];

async function setup(client = fakeClient()) {
  const gladys = createFakeGladys();
  const service = new AmberService(gladys, { createClient: () => client, now: () => at(10) });
  service.configure(normalizeConfig({ api_token: 't' }));
  await service.refreshAll();
  return { gladys, service };
}

const get = (gladys, service, settings = {}) =>
  widget.get(gladys, { settings, language: 'en', units: 'metric', service });

test('the widget is rendered exactly as sent', async () => {
  const { gladys, service } = await setup();
  const content = await get(gladys, service);
  assert.deepEqual(validateWidgetContent(content), []);
  const tile = content.components.find((c) => c.type === 'value');
  assert.equal(tile.value, 24.3);
  assert.equal(tile.unit, 'c/kWh');
});

test('a spike, a tariff period and a costly feed-in are valid too', async () => {
  const { gladys, service } = await setup(
    fakeClient({ prices: pricesAnswer({ descriptor: 'spike', spikeStatus: 'spike', feedIn: 5 }) }),
  );
  const content = await get(gladys, service);
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((c) => c.type === 'status');
  assert.ok(status.items.some((item) => item.color === 'danger'));
});

test('the widget can show a chosen site', async () => {
  const { gladys, service } = await setup();
  const content = await get(gladys, service, { site: siteDeviceExternalId(gladys, site().id) });
  assert.equal(
    content.components.find((c) => c.type === 'status').items.at(-1).value,
    '3052282872',
  );
});

test('without prices yet, the widget says why, still valid', async () => {
  const { gladys, service } = await setup(
    fakeClient({ sites: new AmberApiError(AMBER_ERRORS.UNAUTHORIZED, 'no', { status: 401 }) }),
  );
  const content = await get(gladys, service);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.en, /token/);
});

test('the refresh button answers a short toast in every language', async () => {
  const { gladys, service } = await setup();
  const content = await get(gladys, service);
  const button = content.components.find((c) => c.type === 'button');
  const toast = await widget.action(gladys, { actionKey: button.action.key, params: {}, service });
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.ok(toast[language] && toast[language].length <= 200);
  }
});

test('an unknown widget action fails, so the user sees the error', async () => {
  const { gladys, service } = await setup();
  await assert.rejects(
    widget.action(gladys, { actionKey: 'nope', params: {}, service }),
    /Unknown/,
  );
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
});

test('toCents shows one decimal', () => {
  assert.equal(toCents(0.2433), 24.3);
  assert.equal(toCents(-0.015), -1.5);
});
