// eWeLink Cloud API v2 client — Sonoff smart plugs wired in front of screens
// (per-screen mains switch + power telemetry). Consumed by /api/admin/ewelink/*,
// /api/admin/devices/[id]/{power,plug}, and /api/cron/ewelink-poll.
//
// One-time setup:
//   1. Create an OAuth app at https://dev.ewelink.cc and put its credentials in
//      EWELINK_APP_ID / EWELINK_APP_SECRET.
//   2. Whitelist  https://wearealive.in/api/ewelink/callback  (and the localhost
//      equivalent for dev) as the app's redirect URL in the eWeLink console.
//   3. Admin > Screens > screen drawer > Power > "Connect eWeLink". Tokens land
//      in the EwelinkAccount singleton; the poll cron keeps them refreshed.
//
// Protocol notes (v2, apia hosts):
//   - Login page: https://c2ccdn.coolkit.cc/oauth/index.html with
//     authorization = base64(HMAC-SHA256("<appid>_<seq>", appSecret)).
//   - /v2/user/oauth/token and /v2/user/refresh authenticate with
//     "Authorization: Sign <base64 HMAC-SHA256(JSON body, appSecret)>".
//   - Everything else is "Authorization: Bearer <accessToken>".
//   - Every response is an envelope { error: 0 | code, msg, data }.
//   - Authorization codes from the callback expire in ~30 seconds.

import crypto from 'crypto';
import type { EwelinkAccount } from '@prisma/client';
import { db } from '@/lib/db';

const OAUTH_PAGE = 'https://c2ccdn.coolkit.cc/oauth/index.html';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
// Refresh the access token when it's within 3 days of expiry (tokens last 30
// days; the 5-min poll cron gives plenty of chances inside that window).
const AT_REFRESH_MARGIN_MS = 3 * 24 * 60 * 60 * 1000;

// Device types (uiid) whose power/voltage/current params are integers in
// centi-units (e.g. POW Elite reports 1234 for 12.34 W). The older POW line
// (uiid 5/32/182) reports plain decimal strings in whole units.
const CENTI_UNIT_UIIDS = new Set([190]);
// Metering-capable device types — used as a fallback when a device is offline
// at link time and its params carry no power reading to sniff.
const METERING_UIIDS = new Set([5, 32, 182, 190]);

export function ewelinkConfigured(): boolean {
  return Boolean(process.env.EWELINK_APP_ID && process.env.EWELINK_APP_SECRET);
}

function appId(): string {
  const id = process.env.EWELINK_APP_ID;
  if (!id) throw new Error('EWELINK_APP_ID not configured');
  return id;
}

function appSecret(): string {
  const secret = process.env.EWELINK_APP_SECRET;
  if (!secret) throw new Error('EWELINK_APP_SECRET not configured');
  return secret;
}

// eWeLink's only datacenter regions. `region` arrives from the OAuth callback
// query string and is interpolated into the request host, so it MUST be
// allowlisted — an unvalidated value like "attacker.com/" would turn every
// signed server call into an SSRF to an arbitrary origin.
const EWELINK_REGIONS = new Set(['us', 'eu', 'as', 'cn']);

export function isValidRegion(region: string | null | undefined): region is string {
  return typeof region === 'string' && EWELINK_REGIONS.has(region);
}

export function apiHost(region: string): string {
  if (!isValidRegion(region)) throw new Error(`Invalid eWeLink region: ${region}`);
  return `https://${region}-apia.coolkit.${region === 'cn' ? 'cn' : 'cc'}`;
}

const hmacB64 = (msg: string) =>
  crypto.createHmac('sha256', appSecret()).update(msg).digest('base64');

const nonce = () => crypto.randomBytes(6).toString('base64url').slice(0, 8);

// ─── OAuth ───────────────────────────────────────────────────────────────────

// Self-validating CSRF state: "<ts>.<hmac(ts)>" — no server-side storage needed.
export function makeOauthState(): string {
  const ts = String(Date.now());
  return `${ts}.${crypto.createHmac('sha256', appSecret()).update(`oauth-state:${ts}`).digest('hex').slice(0, 32)}`;
}

export function verifyOauthState(state: string | null): boolean {
  if (!state) return false;
  const [ts, sig] = state.split('.');
  if (!ts || !sig) return false;
  const expected = crypto.createHmac('sha256', appSecret()).update(`oauth-state:${ts}`).digest('hex').slice(0, 32);
  const fresh = Date.now() - Number(ts) < OAUTH_STATE_TTL_MS;
  return fresh && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function buildLoginUrl(redirectUrl: string): string {
  const seq = String(Date.now());
  const params = new URLSearchParams({
    clientId: appId(),
    seq,
    authorization: hmacB64(`${appId()}_${seq}`),
    redirectUrl,
    grantType: 'authorization_code',
    state: makeOauthState(),
    nonce: nonce(),
  });
  return `${OAUTH_PAGE}?${params.toString()}`;
}

type Envelope<T> = { error: number; msg?: string; data?: T };

async function signedPost<T>(host: string, path: string, body: Record<string, unknown>): Promise<T> {
  const json = JSON.stringify(body);
  const res = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CK-Appid': appId(),
      'X-CK-Nonce': nonce(),
      Authorization: `Sign ${hmacB64(json)}`,
    },
    body: json,
  });
  const envelope = (await res.json()) as Envelope<T>;
  if (envelope.error !== 0) throw new Error(`eWeLink ${path} failed (${envelope.error}): ${envelope.msg ?? 'unknown error'}`);
  return envelope.data as T;
}

type TokenData = { accessToken: string; refreshToken: string; atExpiredTime?: number; rtExpiredTime?: number };

export async function exchangeCode(region: string, code: string, redirectUrl: string): Promise<TokenData> {
  return signedPost<TokenData>(apiHost(region), '/v2/user/oauth/token', {
    code,
    redirectUrl,
    grantType: 'authorization_code',
  });
}

// /v2/user/refresh returns short field names: { at, rt }.
async function refreshTokens(region: string, rt: string): Promise<{ at: string; rt: string }> {
  return signedPost<{ at: string; rt: string }>(apiHost(region), '/v2/user/refresh', { rt });
}

// Loads the linked account (singleton), refreshing the access token when it is
// close to expiry. A failed refresh marks the account needsReauth instead of
// throwing so pollers and the admin UI can surface "re-connect" cleanly.
export async function getLinkedAccount(): Promise<EwelinkAccount | null> {
  const account = await db.ewelinkAccount.findUnique({ where: { id: 1 } });
  if (!account || account.needsReauth) return account;

  const nearExpiry = account.atExpiresAt && account.atExpiresAt.getTime() - Date.now() < AT_REFRESH_MARGIN_MS;
  if (!nearExpiry) return account;

  try {
    const t = await refreshTokens(account.region, account.refreshToken);
    return await db.ewelinkAccount.update({
      where: { id: 1 },
      data: {
        accessToken: t.at,
        refreshToken: t.rt,
        // Refreshed access tokens keep the 30-day lifetime; the API does not
        // echo expiry timestamps here, so track it ourselves.
        atExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  } catch {
    return db.ewelinkAccount.update({ where: { id: 1 }, data: { needsReauth: true } });
  }
}

// ─── Bearer-authenticated device API ─────────────────────────────────────────

async function bearer<T>(
  account: EwelinkAccount,
  method: 'GET' | 'POST',
  path: string,
  query?: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<T> {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const res = await fetch(`${apiHost(account.region)}${path}${qs}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-CK-Appid': appId(),
      'X-CK-Nonce': nonce(),
      Authorization: `Bearer ${account.accessToken}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const envelope = (await res.json()) as Envelope<T>;
  if (envelope.error !== 0) {
    // 401/402 = invalid/expired access token — flag for re-auth so the UI and
    // the next poll know rather than failing silently forever.
    if (envelope.error === 401 || envelope.error === 402) {
      await db.ewelinkAccount.update({ where: { id: 1 }, data: { needsReauth: true } }).catch(() => {});
    }
    throw new Error(`eWeLink ${path} failed (${envelope.error}): ${envelope.msg ?? 'unknown error'}`);
  }
  return envelope.data as T;
}

export type EwelinkThing = {
  deviceid: string;
  name: string;
  online: boolean;
  productModel: string | null;
  uiid: number | null;
  params: Record<string, unknown>;
};

type ThingListItem = {
  itemType: number; // 1 = own device, 2 = shared device, 3 = group
  itemData: {
    deviceid?: string;
    name?: string;
    online?: boolean;
    productModel?: string;
    extra?: { uiid?: number };
    params?: Record<string, unknown>;
  };
};

// All devices on the account (paged; params + online included, so one call per
// poll covers every plug).
export async function listThings(account: EwelinkAccount): Promise<EwelinkThing[]> {
  const things: EwelinkThing[] = [];
  let beginIndex = -9999999;
  for (let page = 0; page < 20; page++) {
    const data = await bearer<{ thingList: ThingListItem[]; total: number }>(
      account, 'GET', '/v2/device/thing',
      { num: '30', beginIndex: String(beginIndex) },
    );
    const list = data.thingList ?? [];
    for (const item of list) {
      if (item.itemType === 3 || !item.itemData?.deviceid) continue; // skip groups
      things.push({
        deviceid: item.itemData.deviceid,
        name: item.itemData.name ?? item.itemData.deviceid,
        online: item.itemData.online ?? false,
        productModel: item.itemData.productModel ?? null,
        uiid: item.itemData.extra?.uiid ?? null,
        params: item.itemData.params ?? {},
      });
    }
    if (list.length < 30 || things.length >= data.total) break;
    beginIndex = beginIndex + list.length;
  }
  return things;
}

export async function getThingParams(account: EwelinkAccount, deviceid: string): Promise<Record<string, unknown>> {
  const data = await bearer<{ params: Record<string, unknown> }>(
    account, 'GET', '/v2/device/thing/status', { type: '1', id: deviceid },
  );
  return data.params ?? {};
}

// Toggle the relay. Single-channel devices (BASICR4, POW) take params.switch;
// multi-channel ones take a switches array — mirror whatever shape the device
// last reported.
export async function setSwitch(account: EwelinkAccount, deviceid: string, on: boolean): Promise<void> {
  const current = await getThingParams(account, deviceid);
  const params = Array.isArray(current.switches)
    ? { switches: [{ switch: on ? 'on' : 'off', outlet: 0 }] }
    : { switch: on ? 'on' : 'off' };
  await bearer(account, 'POST', '/v2/device/thing/status', undefined, { type: 1, id: deviceid, params });
}

// ─── Param normalization ─────────────────────────────────────────────────────

export type PowerSnapshot = {
  switchOn: boolean | null;
  powerW: number | null;
  voltageV: number | null;
  currentA: number | null;
};

function numericParam(params: Record<string, unknown>, key: string, uiid: number | null): number | null {
  const raw = params[key];
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  return uiid != null && CENTI_UNIT_UIIDS.has(uiid) ? n / 100 : n;
}

export function readPowerParams(params: Record<string, unknown>, uiid: number | null): PowerSnapshot {
  let switchOn: boolean | null = null;
  if (typeof params.switch === 'string') switchOn = params.switch === 'on';
  else if (Array.isArray(params.switches) && params.switches.length > 0) {
    const first = params.switches[0] as { switch?: string };
    if (typeof first?.switch === 'string') switchOn = first.switch === 'on';
  }
  return {
    switchOn,
    powerW: numericParam(params, 'power', uiid),
    voltageV: numericParam(params, 'voltage', uiid),
    currentA: numericParam(params, 'current', uiid),
  };
}

export function isMeteringDevice(params: Record<string, unknown>, uiid: number | null): boolean {
  return params.power != null || (uiid != null && METERING_UIIDS.has(uiid));
}
