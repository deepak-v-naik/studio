// Admin API authentication — FAIL CLOSED.
//
// The admin surface is guarded by a single shared secret sent in the
// `admin-password` header and checked against ADMIN_PASSWORD. The critical
// property here is the direction of failure: if ADMIN_PASSWORD is ever unset
// (a dropped or misspelled env var, a fresh environment), NO request is
// treated as admin. The previous per-route guard used
//   `!process.env.ADMIN_PASSWORD || pw === process.env.ADMIN_PASSWORD`
// which did the opposite — a missing env var opened the entire admin API
// (fleet control, payouts, KYC, campaigns) to the anonymous internet.
//
// The comparison is constant-time so the secret can't be recovered a byte at a
// time via response timing. timingSafeEqual throws on a length mismatch, so the
// lengths are gated first.

import { timingSafeEqual } from 'crypto';

/** True only when ADMIN_PASSWORD is set AND the header matches it exactly. */
export function isAdminPassword(provided: string | null | undefined): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // fail closed — never authorize without a configured secret
  const got = provided ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Header-based check for a route handler's NextRequest. */
export function isAdmin(req: { headers: { get(name: string): string | null } }): boolean {
  return isAdminPassword(req.headers.get('admin-password'));
}
