// -----------------------------------------------------------------------------
// Amber Electric public API client (https://api.amber.com.au/v1).
//
// Cloud only: Amber is an electricity retailer, there is no device on the LAN
// to talk to. Authentication is a personal API token sent as a Bearer header;
// it is a secret, so it is never logged, not even partially.
//
// Every failure becomes an `AmberApiError` carrying a short `code` the rest of
// the integration turns into a message the user can act on ("the token was
// refused" says what to do, "HTTP 401" does not).
//
// Node 22+ provides `fetch` natively: no dependency. The client takes a
// `fetch` option so the tests run without the network.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'amber-api' });

export const AMBER_API_URL = 'https://api.amber.com.au/v1';

const REQUEST_TIMEOUT_MS = 15_000;

// Amber answers at most 2048 intervals per request (422 beyond).
export const MAX_INTERVALS = 2048;

/** Why a call failed, as the rest of the code reasons about it. */
export const AMBER_ERRORS = {
  NO_TOKEN: 'no_token',
  UNAUTHORIZED: 'unauthorized',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  SERVER: 'server',
  NETWORK: 'network',
  BAD_RESPONSE: 'bad_response',
};

export class AmberApiError extends Error {
  /**
   * @param {string} code one of AMBER_ERRORS
   * @param {string} message technical detail, for the logs
   * @param {{ status?: number, retryAfterSeconds?: number }} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AmberApiError';
    this.code = code;
    this.status = details.status;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

// `RateLimit-Reset` (seconds until the window resets), or the classic
// `Retry-After`. Absent or unreadable: a minute, the shortest refresh anyway.
function retryAfterSeconds(headers) {
  for (const name of ['ratelimit-reset', 'retry-after']) {
    const value = Number(headers?.get?.(name));
    if (Number.isFinite(value) && value > 0) {
      return Math.ceil(value);
    }
  }
  return 60;
}

function errorForStatus(status, headers, path) {
  if (status === 401 || status === 403) {
    return new AmberApiError(AMBER_ERRORS.UNAUTHORIZED, `Amber refused the API token (${status})`, {
      status,
    });
  }
  if (status === 404) {
    return new AmberApiError(AMBER_ERRORS.NOT_FOUND, `Amber does not know ${path} (404)`, {
      status,
    });
  }
  if (status === 429) {
    return new AmberApiError(AMBER_ERRORS.RATE_LIMITED, 'Amber rate limit reached (429)', {
      status,
      retryAfterSeconds: retryAfterSeconds(headers),
    });
  }
  if (status >= 500) {
    return new AmberApiError(AMBER_ERRORS.SERVER, `Amber server error (${status})`, { status });
  }
  return new AmberApiError(AMBER_ERRORS.BAD_RESPONSE, `Unexpected Amber answer (${status})`, {
    status,
  });
}

/**
 * Build a client bound to one API token.
 * @param {{ token: string, fetch?: typeof fetch, baseUrl?: string }} options
 */
export function createAmberClient({ token, fetch: fetchImpl = globalThis.fetch, baseUrl } = {}) {
  const root = baseUrl ?? AMBER_API_URL;

  async function get(path, query = {}) {
    if (!token) {
      throw new AmberApiError(AMBER_ERRORS.NO_TOKEN, 'No Amber API token configured');
    }
    const url = new URL(`${root}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    logger.debug(`GET ${url.pathname}${url.search}`);

    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // DNS failure, refused connection, timeout: the container cannot reach
      // Amber. The message of a fetch error never carries the headers.
      throw new AmberApiError(AMBER_ERRORS.NETWORK, `Amber unreachable: ${err?.message ?? err}`);
    }
    if (!response.ok) {
      throw errorForStatus(response.status, response.headers, url.pathname);
    }
    try {
      return await response.json();
    } catch (err) {
      throw new AmberApiError(AMBER_ERRORS.BAD_RESPONSE, `Unreadable Amber answer: ${err.message}`);
    }
  }

  return {
    /** The sites (NMIs) of the account: `[{ id, nmi, channels, network, status, intervalLength }]`. */
    async getSites() {
      const sites = await get('/sites');
      if (!Array.isArray(sites)) {
        throw new AmberApiError(AMBER_ERRORS.BAD_RESPONSE, 'GET /sites did not answer a list');
      }
      return sites;
    },

    /**
     * The current interval of every channel, plus `next` forecast intervals.
     * @param {string} siteId
     * @param {{ next?: number, previous?: number, resolution?: number }} [options]
     */
    async getCurrentPrices(siteId, { next = 0, previous = 0, resolution } = {}) {
      const intervals = await get(`/sites/${encodeURIComponent(siteId)}/prices/current`, {
        next: Math.min(next, MAX_INTERVALS - previous - 1),
        previous,
        resolution,
      });
      if (!Array.isArray(intervals)) {
        throw new AmberApiError(
          AMBER_ERRORS.BAD_RESPONSE,
          'GET /prices/current did not answer a list',
        );
      }
      return intervals;
    },
  };
}
