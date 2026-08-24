// Push-notification registration for screen-offline alerts.
//
// The server tells a partner their screen is down (and back up) via
// device-alerts.ts → pushExpoToStore(). This module's job is the other half:
// get the phone's Expo push token and hand it to the server, bound to the
// signed-in store. Everything here is best-effort — a partner who denies the
// permission simply falls back to WhatsApp + the dashboard banner, and no
// failure here may ever break the dashboard.
//
// NOTE: the root app/_layout.tsx must import this module so the foreground
// notification handler below is installed for EVERY route, not just the
// dashboard group — an alert arriving while the partner is on the sign-in or
// KYC screen must still be presented.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerPushToken, unregisterPushToken, type StoreSession } from './api';

// Show alerts even when the app is foregrounded — a shopkeeper looking at the
// dashboard should still see "your screen is offline" land.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});

// Dedupe cache so every dashboard mount doesn't re-POST the same binding.
// Keyed by store AND token: the same phone (same token) signing into a
// different store MUST re-register, or the server row would keep routing the
// previous store's alerts to this phone.
let lastRegisteredKey: string | null = null;

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Must exist before a notification arrives, and must match the channelId
  // the server sends (src/lib/expo-push.ts → channelId: 'alerts').
  await Notifications.setNotificationChannelAsync('alerts', {
    name:             'Screen alerts',
    importance:       Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor:       '#ef4444',
  });
}

/**
 * Mints this device's Expo push token.
 * @param promptIfNeeded whether the OS permission dialog may be shown. Sign-in
 *   paths pass true; the sign-out path passes false — popping "Allow
 *   notifications?" during logout, for a permission the app is about to stop
 *   using, would be absurd.
 */
async function getPushToken(promptIfNeeded: boolean): Promise<string | null> {
  // Simulators/emulators have no push transport; Expo Go on SDK 52+ can't do
  // remote push on Android either — both just no-op.
  if (!Device.isDevice) return null;

  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    if (!promptIfNeeded) return null;
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null; // not an EAS build — nowhere to mint a token from

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data ?? null;
}

/**
 * Registers this phone for the signed-in store's screen alerts.
 * Call whenever a session is (re)established — duplicate calls are cheap.
 */
export async function registerForPush(session: StoreSession | null | undefined): Promise<void> {
  try {
    if (!session?.token || !session.id) return; // not signed in — nothing to bind to
    const token = await getPushToken(true);
    if (!token) return;
    const key = `${session.id}:${token}`;
    if (key === lastRegisteredKey) return;
    await registerPushToken(token, session);
    lastRegisteredKey = key;
  } catch {
    /* best-effort — never break the dashboard */
  }
}

/**
 * Unbinds this phone from the store's alerts. Call on sign-out, while the
 * session is still valid — the server route requires it for auth.
 */
export async function unregisterPush(session: StoreSession | null | undefined): Promise<void> {
  // Clear the dedupe cache FIRST, unconditionally: if the DELETE below fails
  // (offline sign-out, server hiccup), the next sign-in must not skip its
  // re-registration — a poisoned cache here would leave the server row bound
  // to the previous store, leaking its alerts to whoever signs in next.
  const cached = lastRegisteredKey;
  lastRegisteredKey = null;
  try {
    if (!session?.token) return;
    // Never prompt for the permission during sign-out; if we can't mint the
    // token silently, fall back to the one we registered this process.
    const token = (await getPushToken(false)) ?? cached?.split(':').slice(1).join(':') ?? null;
    if (!token) return;
    await unregisterPushToken(token, session);
  } catch {
    /* best-effort — a stale token is pruned server-side on first dead delivery */
  }
}
