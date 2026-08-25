// fetch() for store-partner APIs that works without a next-auth cookie.
//
// The dashboard's data fetches historically relied on the session cookie
// alone, so an expired cookie silently 401'd every panel into its empty
// state — a partner's offers/KYC/payments looked deleted. Attaching the
// signed x-store-token cached in localStorage (minted at registration and
// login, refreshed by every successful /api/stores/me GET) lets
// resolveStoreId() authenticate the call server-side even when the cookie
// is gone.

const LS_SESSION_KEY = 'alive_store_session';

export function cachedStoreToken(): string | null {
  try {
    const raw = localStorage.getItem(LS_SESSION_KEY);
    if (!raw) return null;
    const token = (JSON.parse(raw) as { token?: unknown }).token;
    return typeof token === 'string' && token ? token : null;
  } catch { return null; }
}

export function storeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = cachedStoreToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.has('x-store-token')) headers.set('x-store-token', token);
  return fetch(input, { ...init, headers });
}
