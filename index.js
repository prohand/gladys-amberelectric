// -----------------------------------------------------------------------------
// Entry point of the Amber Electric integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the price loop (src/service.js). It holds
// no Amber logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, reads the Amber sites and starts the price loop.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { applyLogLevel, normalizeConfig } from './src/config.js';
import { AmberService } from './src/service.js';
import { SITE_ERRORS, connectionReport, describeError } from './src/connection.js';
import { localize, pick } from './src/i18n.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './src/capabilities/widget.js';

const gladys = new GladysIntegration();
const service = new AmberService(gladys);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();
service.configure(config);

// Read the config, then the sites of the account, publish them as devices and
// (re)start the price loop. Run on every (re)connection and configuration save.
async function initialize(rawConfig) {
  config = normalizeConfig(rawConfig);
  applyLogLevel(config);
  service.configure(config);
  service.stop();
  try {
    await service.syncSites();
  } catch (err) {
    // The loop retries the sites at every refresh, and reports the status.
    logger.warn(`Amber sites not read yet: ${err.message}`);
  }
  service.start();
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the Amber sites');
  await service.syncSites();
});

// --- Manifest actions: buttons in the Configuration screen -------------------
// "Test the connection" reads the account live, whatever the loop knows: it is
// the button a user presses right after pasting a token.
gladys.onAction('test_connection', async () => {
  logger.info('Action test_connection');
  try {
    const followed = await service.syncSites();
    await service.refreshAll();
    return connectionReport(
      service.allSites,
      service.snapshots,
      new Set(followed.map((site) => site.id)),
    );
  } catch (err) {
    logger.warn(`Test the connection failed: ${err.message}`);
    if (err.code !== SITE_ERRORS.SITE_NOT_FOUND || !service.allSites) {
      return describeError(err);
    }
    // A mistyped Site field: say so, then list the ids it can take.
    const message = describeError(err);
    const report = connectionReport(service.allSites, new Map(), new Set());
    return localize((language) => `${pick(language, message)}\n${pick(language, report)}`);
  }
});

// --- Scene actions: operations a scene author placed in a scene -------------
// Each action of the manifest `scene_actions` is registered per key (Gladys
// 5.1+). The handler receives the RESOLVED fields and returns the declared
// outputs. Scene TRIGGERS need no handler: the price loop fires them.
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(gladys, { fields, service }));
}

// --- Dashboard widgets -------------------------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, service }));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings, service }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await initialize(newConfig);
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name).
gladys.on('connected', async () => {
  try {
    await initialize(await gladys.getConfig());
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
        es: 'La inicialización ha fallado, revise los registros de la integración.',
      })
      .catch(() => {});
  }
});

// While Gladys is away nothing could take the states: stop calling Amber.
gladys.on('disconnected', () => {
  service.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  service.stop();
});

// Never let a forgotten promise take the integration down.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Amber Electric integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
