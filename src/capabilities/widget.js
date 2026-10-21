// -----------------------------------------------------------------------------
// Dashboard widget "Amber prices" (SDK v0.14+, Gladys 5.1+).
//
// What a glance at the dashboard should answer: how much is electricity right
// now, is it cheap or expensive, is a spike coming, and when is it cheapest in
// the next hours.
//
// The tiles are COMPUTED from the snapshot of the last refresh, not bound to
// the device features: they show in cents per kWh, the unit Amber uses in its
// own app (the device features are in $/kWh, the Gladys unit), and they work
// before the user has created the device in Gladys. The price loop nudges the
// widget after every refresh (requestWidgetRefresh), so the TTL is only a
// safety net.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, createLogger } from '@gladysassistant/integration-sdk';
import { CHANNELS, cheapestWindow, timeline } from '../amber/prices.js';
import {
  CHANNEL_LABELS,
  LEVEL_COLORS,
  LEVEL_LABELS,
  PERIOD_LABELS,
  SPIKE_COLORS,
  SPIKE_LABELS,
} from '../amber/labels.js';
import { describeError } from '../connection.js';
import { siteDeviceExternalId } from '../devices/site.js';

const logger = createLogger({ name: 'widget' });

/** Widget key, as declared in the manifest `widgets` field. Never renamed. */
export const PRICES_WIDGET = 'amber_prices';

/** Keys of the `button` actions the content declares. */
export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

// The chart marks the cheapest hour of the forecast: what most users look for.
const CHEAPEST_WINDOW_MINUTES = 60;
const MAX_SPIKE_ANNOTATIONS = 3;

/** $/kWh -> c/kWh, one decimal: "24.3", the way Amber shows it. */
export function toCents(dollars) {
  return Math.round(dollars * 1000) / 10;
}

function points(list) {
  return list.map((point) => ({ t: point.startTime, v: toCents(point.price) }));
}

function siteFor(service, settings) {
  const sites = service.sites ?? [];
  if (settings?.site) {
    return sites.find((site) => siteDeviceExternalId(service.gladys, site.id) === settings.site);
  }
  return sites[0];
}

function emptyContent(service) {
  const text = service.lastError
    ? describeError(service.lastError)
    : {
        en: 'Waiting for the first Amber prices…',
        fr: 'En attente des premiers prix Amber…',
        de: 'Warten auf die ersten Amber-Preise…',
        es: 'Esperando los primeros precios de Amber…',
      };
  return { ttl_seconds: 60, components: [{ type: 'text', text }] };
}

function forecastChart(snapshot) {
  const general = timeline(snapshot, CHANNELS.GENERAL);
  const series = [{ name: CHANNEL_LABELS.general, points: points(general) }];
  const feedIn = timeline(snapshot, CHANNELS.FEED_IN);
  if (feedIn.length > 0) {
    series.push({ name: CHANNEL_LABELS.feedIn, points: points(feedIn) });
  }

  const annotations = [];
  const cheapest = cheapestWindow(general, CHEAPEST_WINDOW_MINUTES);
  if (cheapest) {
    annotations.push({
      t: cheapest.startTime,
      value: toCents(cheapest.averagePrice),
      label: { en: 'Cheapest', fr: 'Moins cher', de: 'Günstigste', es: 'Más barato' },
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  general
    .filter((point) => point.spikeStatus !== 'none')
    .slice(0, MAX_SPIKE_ANNOTATIONS)
    .forEach((point) =>
      annotations.push({
        t: point.startTime,
        value: toCents(point.price),
        label: { en: 'Spike', fr: 'Pic', de: 'Spitze', es: 'Pico' },
        color: SPIKE_COLORS[point.spikeStatus],
      }),
    );

  return {
    type: 'chart',
    chart_type: 'stepline',
    title: { en: 'Forecast', fr: 'Prévisions', de: 'Prognose', es: 'Previsión' },
    unit: 'c/kWh',
    series,
    annotations,
    now_marker: true,
  };
}

export const WIDGETS = {
  [PRICES_WIDGET]: {
    async get(gladys, { settings, service }) {
      logger.debug(`onWidgetGet <- ${PRICES_WIDGET}`);
      const site = siteFor(service, settings);
      const snapshot = site ? service.snapshotOf(site.id) : null;
      const general = snapshot?.channels?.[CHANNELS.GENERAL];
      if (!general) {
        return emptyContent(service);
      }
      const feedIn = snapshot.channels[CHANNELS.FEED_IN];

      const tiles = [
        {
          type: 'value',
          label: { en: 'Price now', fr: 'Prix actuel', de: 'Aktueller Preis', es: 'Precio actual' },
          icon: 'zap',
          value: toCents(general.price),
          unit: 'c/kWh',
          color: LEVEL_COLORS[general.level],
        },
      ];
      if (feedIn) {
        tiles.push({
          type: 'value',
          label: CHANNEL_LABELS.feedIn,
          icon: 'sun',
          value: toCents(feedIn.price),
          unit: 'c/kWh',
          color: feedIn.price < 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
        });
      }
      tiles.push({
        type: 'value',
        label: { en: 'Renewables', fr: 'Renouvelables', de: 'Erneuerbare', es: 'Renovables' },
        icon: 'wind',
        value: general.renewables,
        unit: '%',
        color: WIDGET_COLORS.INFO,
      });

      const statusItems = [
        {
          label: {
            en: 'Price level',
            fr: 'Niveau de prix',
            de: 'Preisniveau',
            es: 'Nivel de precio',
          },
          icon: 'trending-up',
          value: LEVEL_LABELS[general.level],
          color: LEVEL_COLORS[general.level],
        },
        {
          label: { en: 'Price spike', fr: 'Pic de prix', de: 'Preisspitze', es: 'Pico de precio' },
          icon: 'alert-triangle',
          value: SPIKE_LABELS[general.spikeStatus],
          color: SPIKE_COLORS[general.spikeStatus],
        },
      ];
      if (general.period && PERIOD_LABELS[general.period]) {
        statusItems.push({
          label: {
            en: 'Tariff period',
            fr: 'Période tarifaire',
            de: 'Tarifzeit',
            es: 'Periodo tarifario',
          },
          icon: 'clock',
          value: PERIOD_LABELS[general.period],
          color: WIDGET_COLORS.NEUTRAL,
        });
      }
      statusItems.push({
        label: {
          en: 'Meter (NMI)',
          fr: 'Compteur (NMI)',
          de: 'Zähler (NMI)',
          es: 'Contador (NMI)',
        },
        icon: 'home',
        value: String(site.nmi),
        color: service.siteErrors?.has(site.id) ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
      });

      return {
        ttl_seconds: 300,
        components: [
          ...tiles,
          forecastChart(snapshot),
          { type: 'status', items: statusItems },
          {
            type: 'button',
            label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
            icon: 'refresh-cw',
            style: 'secondary',
            action: { key: WIDGET_ACTIONS.REFRESH },
          },
        ],
      };
    },

    // The toast of the button. After a successful action the core drops the
    // cached content and every open dashboard refetches it.
    async action(gladys, { actionKey, service }) {
      logger.info(`onWidgetAction <- ${PRICES_WIDGET}.${actionKey}`);
      if (actionKey !== WIDGET_ACTIONS.REFRESH) {
        // Throwing acks the action as failed: the message reaches the user.
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      await service.refreshAll();
      if (service.lastError) {
        return describeError(service.lastError);
      }
      return {
        en: 'Amber prices refreshed.',
        fr: 'Prix Amber actualisés.',
        de: 'Amber-Preise aktualisiert.',
        es: 'Precios de Amber actualizados.',
      };
    },
  },
};

/**
 * Freshness nudge: ask the core to re-pull every widget NOW instead of
 * waiting for the content TTL. Fire-and-forget: rate-limited core-side to 1
 * per 10 s per widget, dropped silently while disconnected.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    try {
      gladys.requestWidgetRefresh(key);
    } catch {
      // Only throws on an invalid key, which the tests rule out.
    }
  }
}
