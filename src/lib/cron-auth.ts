// Cron / internal-agent authentication — FAIL CLOSED.
//
// These routes are not read-only: the health sweep flips device status, opens
// alerts and sends WhatsApp messages to partners; the eWeLink poll drives
// physical relays; the signal collectors call paid third-party APIs. An
// anonymous caller able to trigger them can spam partners, churn data and burn
// spend.
//
// The previous guard was `if (process.env.CRON_SECRET && auth !== ...)`, which
// only enforced anything when the secret happened to be set — so a missing
// variable left all of them open to the internet. This is the same fail-open
// shape that was fixed for the admin surface, and it is fixed here the same
// way: no configured secret means no caller is authorized.
//
// The comparison is constant-time; a bearer token is a credential and must not
// be recoverable through response timing.

import { timingSafeEqual } from 'crypto';

/**
 * True only when CRON_SECRET is configured AND the request carries it as a
 * bearer token. Pass the raw Authorization header.
 */
export function isCronAuthorized(authHeader: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const expected = `Bearer ${secret}`;
  const got = authHeader ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
