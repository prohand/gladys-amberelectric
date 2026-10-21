// -----------------------------------------------------------------------------
// The price loop: everything between the Amber API and Gladys.
//
// One refresh reads, for every followed site, ONE `prices/current` answer
// (current interval of every channel + the forecast) and fans it out:
//   - the device states (prices, renewables), sent only when they changed;
//   - the scene triggers, on a change of level / spike / feed-in status;
//   - the snapshot the dashboard widget and the scene actions read;
//   - the transport badge (cloud, or unreachable) and the connection status.
//
// Amber limits the calls per account, so nothing else calls the API on a
// timer, and a 429 pauses the loop until the window Amber names is over.
//
// Refreshes are aligned on Amber's five-minute intervals (a quarter of a
// minute after each one starts, when the new price is out), instead of
// drifting from whenever the integration started: a price changes at :00,
// :05, :10…, and a read at :04 would show the old one for four minutes.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { AMBER_ERRORS, AmberApiError, createAmberClient } from './amber/client.js';
import { intervalsFor, summarizePrices } from './amber/prices.js';
import { buildSiteDevice, siteDeviceExternalId, siteStates } from './devices/site.js';
import { baselineOf, publishSceneEvents, sceneEventsFor } from './capabilities/scenes.js';
import { refreshWidgets } from './capabilities/widget.js';
import { SITE_ERRORS, describeError } from './connection.js';

const logger = createLogger({ name: 'service' });

// A refresh lands this long after the start of an interval: Amber needs a few
// seconds to publish the new price.
const REFRESH_OFFSET_MS = 15_000;

// An unchanged price is still sent every half hour, so the Gladys state stays
// recently dated (a flat price for hours is common at night).
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * Milliseconds until the next refresh: the next multiple of the refresh
 * interval (counted from midnight UTC, so a 5-minute interval falls on the
 * NEM intervals), plus a small offset.
 * @param {number} nowMs
 * @param {number} pollSeconds
 */
export function nextRefreshDelay(nowMs, pollSeconds) {
  const period = pollSeconds * 1000;
  const next = (Math.floor((nowMs - REFRESH_OFFSET_MS) / period) + 1) * period + REFRESH_OFFSET_MS;
  return Math.max(1000, next - nowMs);
}

/**
 * The sites to follow: the one named in the configuration, or every active
 * site of the account.
 * @returns {object[]}
 * @throws {AmberApiError} SITE_NOT_FOUND when the named site does not exist
 */
export function selectSites(sites, siteId) {
  if (siteId) {
    const site = sites.find((candidate) => candidate.id === siteId || candidate.nmi === siteId);
    if (!site) {
      throw new AmberApiError(SITE_ERRORS.SITE_NOT_FOUND, `No Amber site with id ${siteId}`);
    }
    return [site];
  }
  return sites.filter((site) => site.status === 'active');
}

export class AmberService {
  /**
   * @param {object} gladys the SDK instance
   * @param {{ createClient?: typeof createAmberClient, now?: () => number }} [options]
   */
  constructor(gladys, { createClient = createAmberClient, now = () => Date.now() } = {}) {
    this.gladys = gladys;
    this.createClient = createClient;
    this.now = now;
    this.config = null;
    this.client = null;
    this.reset();
    this.timer = null;
    this.generation = 0;
    this.inFlight = null;
  }

  reset() {
    // Every site of the account, and the followed ones; null = not read yet.
    this.allSites = null;
    this.sites = null;
    this.snapshots = new Map();
    this.baselines = new Map();
    this.siteErrors = new Map();
    this.lastError = null;
    this.lastSuccessAt = null;
    this.rateLimitedUntil = 0;
    this.statusKey = null;
  }

  /**
   * Take a (new) configuration. A new token or another site starts from
   * scratch: the sites, the snapshots and the trigger baselines belong to the
   * previous account.
   */
  configure(config) {
    const previous = this.config;
    this.config = config;
    if (
      !previous ||
      previous.api_token !== config.api_token ||
      previous.site_id !== config.site_id
    ) {
      this.client = this.createClient({ token: config.api_token });
      this.reset();
    }
  }

  /** Read the sites of the account and publish the followed ones as devices. */
  async syncSites() {
    const all = await this.client.getSites();
    // Kept even when the Site field names none of them: "Test the connection"
    // lists them, so the user can copy the right id.
    this.allSites = all;
    const followed = selectSites(all, this.config.site_id);
    this.sites = followed;
    logger.info(
      `Amber account: ${all.length} site(s), following ${followed.map((site) => site.nmi).join(', ') || 'none'}`,
    );
    await this.gladys.publishDiscoveredDevices(this.buildDevices());
    return followed;
  }

  buildDevices() {
    return (this.sites ?? []).map((site) => buildSiteDevice(this.gladys, site));
  }

  /**
   * One refresh of every followed site. Concurrent calls (the widget button
   * while the timer fires) share the same run.
   */
  refreshAll() {
    if (!this.inFlight) {
      this.inFlight = this.runRefresh().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  async runRefresh() {
    if (this.now() < this.rateLimitedUntil) {
      logger.debug('Refresh skipped: Amber rate limit window still open');
      return;
    }
    let failure = null;
    try {
      if (!this.sites) {
        await this.syncSites();
      }
      if (this.sites.length === 0) {
        failure = new AmberApiError(SITE_ERRORS.NO_SITE, 'No active Amber site');
      }
      for (const site of this.sites) {
        try {
          await this.refreshSite(site);
          this.siteErrors.delete(site.id);
        } catch (err) {
          this.siteErrors.set(site.id, err);
          failure = err;
          this.handleFailure(err, `site ${site.nmi}`);
          if (err.code === AMBER_ERRORS.RATE_LIMITED || err.code === AMBER_ERRORS.UNAUTHORIZED) {
            break;
          }
        }
      }
    } catch (err) {
      failure = err;
      this.handleFailure(err, 'sites');
    }
    if (!failure) {
      this.lastSuccessAt = this.now();
    }
    this.lastError = failure;
    await this.publishTransports();
    await this.reportStatus(failure);
    refreshWidgets(this.gladys);
  }

  handleFailure(err, what) {
    if (err?.code === AMBER_ERRORS.RATE_LIMITED) {
      this.rateLimitedUntil = this.now() + (err.retryAfterSeconds ?? 60) * 1000;
    }
    logger.warn(`Amber read failed (${what}): ${err?.message ?? err}`);
  }

  async refreshSite(site) {
    const snapshot = await this.fetchSnapshot(site, this.config.forecast_hours);
    const device = siteDeviceExternalId(this.gladys, site.id);
    const general = snapshot.channels.general;
    logger.debug(
      `Site ${site.nmi}: ${general?.price ?? '?'} $/kWh (${general?.level ?? '?'}, spike ${general?.spikeStatus ?? '?'})`,
    );

    this.snapshots.set(site.id, snapshot);
    const events = sceneEventsFor(device, this.baselines.get(site.id), snapshot);
    this.baselines.set(site.id, baselineOf(snapshot));

    const states = siteStates(this.gladys, site, snapshot);
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    } catch (err) {
      // Typically the device is not created in Gladys yet (Discovery tab):
      // the states will follow once it is. Never a reason to lose the events.
      logger.debug(`States of site ${site.nmi} not taken by Gladys: ${err.message}`);
    }
    await publishSceneEvents(this.gladys, events);
  }

  /** A fresh snapshot of one site, without touching the states or the triggers. */
  async fetchSnapshot(site, forecastHours) {
    const intervals = await this.client.getCurrentPrices(site.id, {
      next: intervalsFor(forecastHours, site.intervalLength),
    });
    return summarizePrices(intervals, new Date(this.now()));
  }

  /**
   * The snapshot a widget or a scene action reads: the last refresh when it
   * is recent and covers the forecast asked for, a fresh read otherwise.
   */
  async readSnapshot(site, { forecastHours } = {}) {
    const cached = this.snapshots.get(site.id);
    const maxAge = (this.config.poll_frequency + 60) * 1000;
    const covers = !forecastHours || forecastHours <= this.config.forecast_hours;
    if (cached && covers && this.now() - Date.parse(cached.fetchedAt) <= maxAge) {
      return cached;
    }
    return this.fetchSnapshot(site, Math.max(forecastHours ?? 0, this.config.forecast_hours));
  }

  snapshotOf(siteId) {
    return this.snapshots.get(siteId) ?? null;
  }

  /** The followed site behind a device external_id (a "source: devices" field). */
  async siteByDevice(externalId) {
    if (!this.sites) {
      await this.syncSites();
    }
    const site = this.sites.find(
      (candidate) => siteDeviceExternalId(this.gladys, candidate.id) === externalId,
    );
    if (!site) {
      throw new Error(`Not an Amber site followed by this integration: ${externalId}`);
    }
    return site;
  }

  async publishTransports() {
    if (!this.sites?.length) {
      return;
    }
    const entries = this.sites.map((site) => ({
      external_id: siteDeviceExternalId(this.gladys, site.id),
      transport:
        this.snapshots.has(site.id) && !this.siteErrors.has(site.id)
          ? DEVICE_TRANSPORTS.CLOUD
          : DEVICE_TRANSPORTS.UNREACHABLE,
    }));
    try {
      await this.gladys.publishTransports(entries);
    } catch (err) {
      logger.debug(`Transport badges not taken by Gladys: ${err.message}`);
    }
  }

  // The status is only sent when it changes: every five minutes the same
  // "connected" would be noise on the host API.
  async reportStatus(failure) {
    const key = failure ? `error:${failure.code}` : 'ok';
    if (key === this.statusKey) {
      return;
    }
    try {
      if (failure) {
        await this.gladys.setConnectionStatus(false, describeError(failure));
      } else {
        await this.gladys.setConnectionStatus(true);
      }
      this.statusKey = key;
    } catch (err) {
      logger.debug(`Connection status not taken by Gladys: ${err.message}`);
    }
  }

  /** Start the loop: one refresh now, then aligned on the refresh interval. */
  start() {
    this.stop();
    // A refresh still running when the loop is restarted (a reconnection, a
    // configuration saved) must not schedule a second loop next to the new one.
    const generation = this.generation;
    const loop = async () => {
      try {
        await this.refreshAll();
      } catch (err) {
        logger.error('Refresh failed', err);
      }
      if (generation === this.generation) {
        this.timer = setTimeout(loop, nextRefreshDelay(this.now(), this.config.poll_frequency));
      }
    };
    this.timer = setTimeout(loop, 0);
  }

  stop() {
    this.generation += 1;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
