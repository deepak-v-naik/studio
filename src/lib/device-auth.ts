// Device JWT auth helpers.
// Each device gets a unique secret on claim. The player signs every request:
//   Authorization: Bearer <jwt>
// Payload: { sub: deviceId, iat, exp }

import { SignJWT, jwtVerify } from 'jose';

const ALG = 'HS256';

export async function signDeviceToken(deviceId: string, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ sub: deviceId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(key);
}

/**
 * Whether a device may act on its token beyond the pairing handshake.
 *
 * /api/device/claim is unauthenticated by necessity — a screen has no
 * credential until it claims one — so a token alone proves only that someone
 * POSTed a hardwareKey, not that ALIVE ever agreed to run that screen. The
 * admin confirming the on-screen code (which sets pairedAt) is the human
 * authorization step, and it is what separates a real screen from anyone who
 * called the claim endpoint.
 *
 * Unpaired devices keep exactly one capability: polling pairing-status until an
 * operator confirms them. They must not read plans (another store's content and
 * schedule) and must not write proof-of-play (billable evidence advertisers are
 * invoiced against).
 *
 * Devices already in the field are backdated by the 20260826120000 migration,
 * so this gate only ever blocks screens that were never confirmed.
 */
export function isDevicePaired(device: { pairedAt: Date | null }): boolean {
  return device.pairedAt !== null;
}

export async function verifyDeviceToken(
  token: string,
  secret: string,
): Promise<{ deviceId: string } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    if (!payload.sub) return null;
    return { deviceId: payload.sub };
  } catch {
    return null;
  }
}
