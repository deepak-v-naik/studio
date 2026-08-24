import { API_BASE_URL } from '@shared/constants';
import type { StoreSession, RegisterPayload } from '@shared/store-types';

export type { StoreSession, RegisterPayload };

/**
 * x-store-token header for authenticated store APIs. The server no longer
 * trusts a bare storeId — every call that passes one must also send the
 * signed token from the session (minted at login, refreshed by /api/stores/me).
 */
export function authHeaders(token?: string | null): Record<string, string> {
  return token ? { 'x-store-token': token } : {};
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
    return body as T;
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
    throw err;
  } finally {
    clearTimeout(tid);
  }
}

export async function storeLogin(
  whatsapp: string,
  password: string,
): Promise<{ store?: StoreSession; error?: string }> {
  return request('/api/stores/login', {
    method: 'POST',
    body: JSON.stringify({ phone: `+91${whatsapp}`, password }),
  });
}

export async function storeRegister(
  payload: RegisterPayload,
): Promise<{ success?: boolean; referralCode?: string; error?: string; statusCode?: number }> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${API_BASE_URL}/api/stores/save`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({})) as { success?: boolean; referralCode?: string; error?: string; data?: { error?: string; referralCode?: string } };
    if (!res.ok) {
      const msg = body.data?.error ?? body.error ?? `HTTP ${res.status}`;
      return { error: msg, statusCode: res.status };
    }
    return { success: true, referralCode: body.data?.referralCode ?? body.referralCode };
  } catch (e) {
    const err = e as Error;
    return { error: err.name === 'AbortError' ? 'Request timed out. Please try again.' : err.message };
  } finally {
    clearTimeout(tid);
  }
}

export async function getStoreMe(storeId?: string, token?: string | null): Promise<StoreSession> {
  const qs = storeId ? `?storeId=${storeId}` : '';
  return request(`/api/stores/me${qs}`, { headers: authHeaders(token) });
}

export async function requestPasswordReset(phone: string): Promise<void> {
  await request('/api/stores/reset-password', {
    method: 'POST',
    body: JSON.stringify({ action: 'request', phone }),
  });
}

export async function verifyPasswordReset(
  phone: string,
  otp: string,
  newPassword: string,
): Promise<{ ok?: boolean; error?: string }> {
  return request('/api/stores/reset-password', {
    method: 'POST',
    body: JSON.stringify({ action: 'verify', phone, otp, newPassword }),
  });
}

export async function updateStoreMe(
  patch: Partial<StoreSession>,
  storeId?: string,
  token?: string | null,
): Promise<void> {
  const qs = storeId ? `?storeId=${storeId}` : '';
  await request(`/api/stores/me${qs}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
}

/**
 * Uploads a GPS-verified onboarding photo (shop front / installed TV).
 * Coordinates are REQUIRED — the server rejects uploads without a fix.
 * `source` records where they came from: the photo's EXIF or the device.
 */
export async function uploadVerificationPhoto(opts: {
  storeId: string;
  token?: string | null;
  kind: 'shop' | 'install';
  fileUri: string;
  mimeType: string;
  lat: number;
  lng: number;
  source: 'exif' | 'device';
}): Promise<{ ok: boolean; url: string }> {
  const form = new FormData();
  form.append('storeId', opts.storeId);
  form.append('kind', opts.kind);
  form.append('lat', String(opts.lat));
  form.append('lng', String(opts.lng));
  form.append('source', opts.source);
  // React Native FormData file part: { uri, name, type }
  form.append('file', { uri: opts.fileUri, name: `${opts.kind}.jpg`, type: opts.mimeType } as unknown as Blob);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 45000);
  try {
    const res  = await fetch(`${API_BASE_URL}/api/stores/verification-photo`, {
      method: 'POST', body: form, signal: controller.signal,
      headers: authHeaders(opts.token), // no Content-Type — RN sets the multipart boundary
    });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; url?: string; error?: string };
    if (!res.ok || !body.ok || !body.url) throw new Error(body.error ?? `HTTP ${res.status}`);
    return { ok: true, url: body.url };
  } catch (e) {
    const err = e as Error;
    throw new Error(err.name === 'AbortError' ? 'Upload timed out. Please try again.' : err.message);
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Binds this phone's Expo push token to the signed-in store so the server can
 * push screen-offline alerts (see studio src/lib/device-alerts.ts).
 */
export async function registerPushToken(pushToken: string, session: StoreSession): Promise<void> {
  const qs = session.id ? `?storeId=${session.id}` : '';
  await request(`/api/stores/push-token${qs}`, {
    method: 'POST',
    body: JSON.stringify({ token: pushToken }),
    headers: authHeaders(session.token),
  });
}

/** Unbinds a push token on sign-out (best-effort — dead tokens are also pruned server-side). */
export async function unregisterPushToken(pushToken: string, session: StoreSession): Promise<void> {
  const qs = session.id ? `?storeId=${session.id}` : '';
  await request(`/api/stores/push-token${qs}`, {
    method: 'DELETE',
    body: JSON.stringify({ token: pushToken }),
    headers: authHeaders(session.token),
  });
}
