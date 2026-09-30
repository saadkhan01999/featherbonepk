import axios from 'axios';

import { config } from '@/config/env.js';

/**
 * HTTP clients.
 * ---------------------------------------------------------------------------
 * Two separate clients, mirroring the two separate token families on the server:
 *
 *   apiClient    — website / back office. Bearer access token held in memory,
 *                  auto-refreshed from the httpOnly cookie on 401.
 *   posClient    — the till. Bearer POS token, no refresh (a shift-length
 *                  session that must not silently renew on a shared device).
 *
 * Keeping them apart means a bug in one cannot attach the wrong credential to
 * the other — the server would reject it, but the client should never try.
 */

/*
 * The access token lives in a module variable, not localStorage.
 *
 * localStorage is readable by any injected script, so an XSS bug becomes full
 * account takeover. In memory, the token dies with the tab, and the httpOnly
 * refresh cookie restores the session on reload — which script cannot read.
 */
let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const clearAccessToken = () => {
  accessToken = null;
};

/*
 * ---------------------------------------------------------------------------
 * In-flight GET de-duplication
 * ---------------------------------------------------------------------------
 * If an identical GET is already in the air, join it instead of opening a
 * second one.
 *
 * Why it matters more than it sounds:
 *
 *  • React StrictMode runs every effect twice in development. `useResource`
 *    correctly discards the second result, but the second request has already
 *    left — so every screen hit the API twice, and a server log reads as if the
 *    app were fetching everything in pairs. It was.
 *  • Independently of StrictMode, several components legitimately want the same
 *    thing on mount. `/settings/public` was being fetched four times in one page
 *    load by different consumers.
 *
 * Against a database on the other side of the internet — Atlas from Pakistan is
 * a ~150ms round trip before any work happens — that doubling is what turns a
 * responsive page into a slow one, and under load the surplus connections queue
 * behind each other and the times compound.
 *
 * Only GETs, and only while a request is genuinely in flight. This is not a
 * cache: nothing is retained after the promise settles, so a later read always
 * sees fresh data and no screen can show something stale. Mutations are never
 * merged — two POSTs that look identical are two things the user meant to do.
 */
/** A request is the same request if the URL, query and envelope choice match. */
function requestKey(config) {
  const params = config.params ? JSON.stringify(config.params) : '';
  return `${config.url}?${params}#${config._wantEnvelope ? 'env' : 'data'}`;
}

function dedupedGet(client) {
  const original = client.get.bind(client);

  /*
   * One map per client — never a module-level singleton shared by both.
   *
   * The key is built from the URL alone, because that is all a caller supplies.
   * It carries no notion of who is asking. With a single shared map, a POS
   * request and a back-office request for the same path are the same key, so
   * whichever arrived second would be handed the first one's promise — a
   * response fetched with the other token family entirely.
   *
   * That is the exact isolation the three separate secrets exist to guarantee,
   * undone by a cache key. Scoping the map to the client makes the token part
   * of the identity by construction, so the two can never collide.
   */
  const inFlight = new Map();

  return (url, config = {}) => {
    const key = requestKey({ ...config, url });

    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = original(url, config).finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, promise);
    return promise;
  };
}

/** Unwrap the standard envelope so callers receive the payload directly. */
function unwrapEnvelope(response) {
  const body = response.data;
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    // Some callers (paginated lists) need `meta`. They opt in by setting
    // `_wantEnvelope` on the request config, rather than every caller having to
    // reach through a wrapper it does not care about.
    if (response.config?._wantEnvelope) return body;
    return body.data;
  }
  return body;
}

/** Turn any failure into a consistent Error the UI can render. */
function normaliseError(error) {
  // The request never reached the server.
  if (!error.response) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const wrapped = new Error(
      offline
        ? 'You appear to be offline. Check your connection and try again.'
        : 'Could not reach the server. Please try again.',
    );
    wrapped.code = 'NETWORK_ERROR';
    wrapped.isNetworkError = true;
    return wrapped;
  }

  const { status, data } = error.response;
  const wrapped = new Error(data?.message ?? 'Something went wrong');
  wrapped.status = status;
  wrapped.code = data?.code ?? 'ERROR';
  // Field-level validation errors, for form highlighting.
  wrapped.details = data?.details;
  return wrapped;
}

// --- Website / back-office client -----------------------------------------

export const apiClient = axios.create({
  baseURL: config.apiUrl,
  // Required so the browser sends and stores the httpOnly refresh cookie.
  withCredentials: true,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((request) => {
  if (accessToken) request.headers.Authorization = `Bearer ${accessToken}`;

  /*
   * File uploads must not carry the JSON content type.
   *
   * The instance sets `Content-Type: application/json` as a default. Axios only
   * substitutes `multipart/form-data` when that header is unset, so with an
   * explicit default every FormData upload went out labelled as JSON — and
   * without the boundary parameter the browser generates.
   *
   * The server then parsed a multipart body as JSON, found no file part, and
   * answered "No image was received". Every product photo, category image and
   * payment QR upload failed this way, with an error that pointed at the
   * server rather than at the header.
   *
   * Deleting it here lets the browser set the type and the boundary together,
   * which is the only way to get a parseable multipart request.
   */
  if (request.data instanceof FormData) {
    delete request.headers['Content-Type'];
  }

  return request;
});

/*
 * Silent refresh on 401.
 *
 * `refreshPromise` de-duplicates concurrent refreshes: a dashboard can fire six
 * requests at once, and without this every one of them would trigger its own
 * refresh. Since refresh tokens rotate, the second refresh would present an
 * already-rotated token — which the server correctly treats as theft and
 * responds to by revoking every session, logging the user out.
 */
let refreshPromise = null;

/**
 * Exchange the refresh cookie for a new access token — at most once at a time.
 *
 * Exported so the session restore on mount shares the promise with the 401
 * retry path. Refresh tokens rotate, so concurrent callers must wait on one
 * exchange rather than each invalidating the last.
 */
export function refreshSession() {
  refreshPromise ??= apiClient
    .post('/auth/refresh')
    .then((data) => {
      setAccessToken(data.accessToken);
      return data;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => unwrapEnvelope(response),
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    const canRetry =
      status === 401 &&
      original &&
      !original._retried &&
      // Never try to refresh the refresh call itself, or a login attempt —
      // that would loop.
      !original.url?.includes('/auth/refresh') &&
      !original.url?.includes('/auth/login');

    if (canRetry) {
      original._retried = true;
      try {
        const { accessToken: fresh } = await refreshSession();
        original.headers.Authorization = `Bearer ${fresh}`;
        return apiClient(original);
      } catch {
        clearAccessToken();
        // Let the app decide how to react (redirect to login) rather than
        // hard-navigating from inside a network layer.
        window.dispatchEvent(new CustomEvent('fb:session-expired'));
      }
    }

    return Promise.reject(normaliseError(error));
  },
);

// --- POS terminal client ---------------------------------------------------

/**
 * The till's token is persisted to localStorage, unlike the website's.
 *
 * This is a deliberate, different trade-off: a terminal is a dedicated device
 * in a staffed shop, and a cashier must not be signed out by an accidental
 * page refresh mid-transaction. The token is scoped to the POS secret, expires
 * within a shift, and the physical device is the security boundary.
 */
const POS_TOKEN_KEY = 'fb-pos-token';

export const posSession = {
  get token() {
    try {
      return localStorage.getItem(POS_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  save(token) {
    try {
      localStorage.setItem(POS_TOKEN_KEY, token);
    } catch {
      /* Private mode — the session simply won't survive a reload. */
    }
  },
  clear() {
    try {
      localStorage.removeItem(POS_TOKEN_KEY);
    } catch {
      /* no-op */
    }
  },
};

export const posClient = axios.create({
  baseURL: config.apiUrl,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

posClient.interceptors.request.use((request) => {
  const token = posSession.token;
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});

posClient.interceptors.response.use(
  (response) => unwrapEnvelope(response),
  (error) => {
    // A till session cannot be silently refreshed — the cashier signs in again.
    if (error.response?.status === 401) {
      posSession.clear();
      window.dispatchEvent(new CustomEvent('fb:pos-session-expired'));
    }
    return Promise.reject(normaliseError(error));
  },
);

/*
 * Applied after the interceptors are installed, so the shared promise resolves
 * to the already-unwrapped payload every caller expects — wrapping earlier
 * would hand the second caller a raw axios response.
 */
apiClient.get = dedupedGet(apiClient);
posClient.get = dedupedGet(posClient);

export default apiClient;
