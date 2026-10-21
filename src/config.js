// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it
// (`gladys.getConfig()`) and notifies every change (`gladys.onConfigUpdated()`).
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`, strings typed in a
// number field, or a value out of the bounds the manifest declares.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Personal API token, created on app.amber.com.au/developers. Secret.
  api_token: '',
  // One Amber site id, or empty for every active site of the account.
  site_id: '',
  // Seconds between two price reads. Amber publishes a new price every five
  // minutes, and limits the number of calls per account: a minute is the
  // floor, five minutes the sweet spot.
  poll_frequency: 300,
  // How many hours of forecast are read with each refresh (dashboard chart,
  // "cheapest window" scene action).
  forecast_hours: 12,
  debug_logs: false,
};

// Bounds of the number fields, the same as the manifest `min` / `max`.
export const LIMITS = {
  poll_frequency: { min: 60, max: 3600 },
  forecast_hours: { min: 1, max: 48 },
};

function clamp(value, { min, max }, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...source,
    // A token pasted with a trailing space or newline is the most common
    // "401 for no reason": trim it.
    api_token: String(source.api_token ?? '').trim(),
    site_id: String(source.site_id ?? '').trim(),
    poll_frequency: clamp(
      source.poll_frequency,
      LIMITS.poll_frequency,
      DEFAULT_CONFIG.poll_frequency,
    ),
    forecast_hours: clamp(
      source.forecast_hours,
      LIMITS.forecast_hours,
      DEFAULT_CONFIG.forecast_hours,
    ),
    debug_logs: source.debug_logs === true || source.debug_logs === 'true',
  };
}

// `LOG_LEVEL` as the container was started with: the baseline the
// "Detailed logs" switch goes back to when it is turned off.
const BASELINE_LOG_LEVEL = process.env.LOG_LEVEL;

/**
 * Apply the log level the configuration asks for. The SDK logger re-reads
 * `LOG_LEVEL` on every line, so setting the variable takes effect at once,
 * for every logger already created — no restart.
 * @param {{ debug_logs: boolean }} config normalized configuration
 * @returns {string} the level in force afterwards
 */
export function applyLogLevel(config) {
  const wanted = config.debug_logs ? 'debug' : BASELINE_LOG_LEVEL;
  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }
  return process.env.LOG_LEVEL ?? 'info';
}
