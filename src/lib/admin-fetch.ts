'use client';

// Shared client for the admin dashboard's authenticated endpoints.
//
// Every /api/admin route answers a bad or rotated admin-password with
// `NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`. That body is
// valid JSON, so `r.json()` RESOLVES — a plain
// `.then(r => r.json()).then(setState).catch(...)` never sees an error and
// quietly stores `{error:'Unauthorized'}` where the component expected an array.
// The next `.map`/`.filter`/`.reduce` throws, and because the panels render
// inside the admin page that TypeError reaches the error boundary and blanks the
// whole dashboard with "Something went wrong" — not just the affected panel.
//
// These helpers make the failure loud and local instead: non-2xx throws, and a
// 401 clears the stored session and returns to the password gate.

const SS_AUTH = 'alive_admin';
const SS_PW = 'alive_admin_pw';

/** The admin password held for this tab, or '' if the session is gone. */
export function adminPw(): string {
  try {
    return sessionStorage.getItem(SS_PW) ?? '';
  } catch {
    return '';
  }
}

/** Thrown after a 401 has already triggered the bounce back to the gate. */
export class AdminAuthError extends Error {
  constructor() {
    super('Admin session expired');
    this.name = 'AdminAuthError';
  }
}

function bounceToGate() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SS_AUTH);
  sessionStorage.removeItem(SS_PW);
  window.location.reload();
}

/**
 * GET an admin endpoint and return its parsed body. Throws on any non-2xx, so
 * an error envelope can never reach component state.
 */
export async function adminGet<T>(url: string, password?: string): Promise<T> {
  const res = await fetch(url, { headers: { 'admin-password': password ?? adminPw() } });
  if (res.status === 401) {
    bounceToGate();
    throw new AdminAuthError();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Same as adminGet, but guarantees an array — the shape every list panel
 * assumes. Accepts both a bare array and the `{ data: [...] }` envelope some
 * routes use; anything else is a shape error rather than a landmine in state.
 */
export async function adminGetArray<T>(url: string, password?: string): Promise<T[]> {
  const body = await adminGet<unknown>(url, password);
  if (Array.isArray(body)) return body as T[];
  const nested = (body as { data?: unknown } | null)?.data;
  if (Array.isArray(nested)) return nested as T[];
  throw new Error('Unexpected response shape');
}

/**
 * Same as adminGet, but guarantees a plain object — for the endpoints that
 * return a keyed map rather than a list.
 */
export async function adminGetObject<T extends object>(url: string, password?: string): Promise<T> {
  const body = await adminGet<unknown>(url, password);
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as T;
  throw new Error('Unexpected response shape');
}
