# ALIVE Store — Android Deployment

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js ≥ 18 | `node -v` to check |
| Expo account | Free at [expo.dev](https://expo.dev) |
| Google Play Console account | One-time $25 fee at [play.google.com/console](https://play.google.com/console) |

---

## Step 1 — Install EAS CLI

```bash
npm install -g eas-cli
eas --version   # should print 12.x or higher
```

## Step 2 — Login & link the project

```bash
cd store-app
eas login                 # enter your expo.dev credentials
eas build:configure       # creates / links the EAS project, writes projectId into app.json
```

After `eas build:configure`, open `app.json` and confirm `extra.eas.projectId` is filled in.

## Step 3 — Install dependencies

```bash
npm install
```

---

## Building

### Internal test APK (share via WhatsApp / Drive)

```bash
eas build --platform android --profile preview
```

- Produces a direct-install **.apk**
- No Play Store account needed
- Download link emailed + shown in EAS dashboard
- Install on any Android phone with "Unknown sources" enabled

### Production AAB (Play Store)

```bash
eas build --platform android --profile production
```

- Produces a signed **.aab** (Android App Bundle)
- EAS manages the keystore automatically on first build — **back it up** from the EAS dashboard
- Download the `.aab` from the EAS dashboard

---

## Step 4 — Publish to Play Store

### Option A — Manual upload (recommended for first release)

1. Go to [Play Console](https://play.google.com/console) → **Create app**
2. Fill in: App name = **ALIVE Store**, Default language = **Hindi / English**, App category = **Business**
3. Complete the store listing (description, screenshots, icon)
4. Go to **Release → Internal testing → Create new release**
5. Upload the `.aab` from the EAS dashboard
6. Roll out to internal testers first, then promote to production

### Option B — `eas submit` (automated)

1. Create a Google Play service account:
   - Play Console → Setup → API access → Link to Google Cloud project
   - Create a service account with **Release Manager** role
   - Download the JSON key → save as `store-app/google-service-account.json`
   - Add `google-service-account.json` to `.gitignore`

2. Submit:
   ```bash
   eas submit --platform android --profile production
   ```

---

## Updating the app

There are two kinds of updates — pick the cheaper one:

### A. JS/UI-only changes → OTA update (no Play Store review, minutes to reach users)

Use this for almost everything: screens, styles, copy, business logic, bug fixes, new
API calls — anything that doesn't touch native code, permissions, or app.json's
native config.

```bash
eas update --branch production --message "Fix KYC upload bug"
```

- Already-installed apps check for an update on launch and download the new JS bundle
  in the background, then apply it on the next restart.
- This is the **same mechanism Expo Go / CodePush use** and is fully allowed by
  Google Play policy — you are not bypassing review, just updating your own app's
  JS bundle (same as a web page updating its JS).
- Each build profile maps to a channel (see `eas.json` → `build.<profile>.channel`):
  `production` AABs use the `production` channel, `preview` APKs use `preview`, etc.
  Always push updates to the channel matching the build your users have installed.

### B. Native changes → new build + Play Store submission (versionCode bump required)

You only need this when you:
- Add/remove a native module or Expo plugin
- Change `app.json`'s `android` config (permissions, package name, icon, etc.)
- Upgrade the Expo SDK / React Native version
- Change `runtimeVersion` (this happens automatically with `policy: "appVersion"`
  whenever you bump `version` in `app.json` — so bump `versionCode` too)

```json
"version": "1.1.0",     ← bump for a new runtimeVersion (native change)
"versionCode": 5         ← always increment for every Play Store upload
```

Then rebuild + submit:

```bash
eas build --platform android --profile production
eas submit --platform android --profile production
```

> **Note:** OTA updates only apply to devices running a build with a **matching
> runtimeVersion**. If you bump `version` (and therefore `runtimeVersion`), you must
> ship a new AAB before `eas update` will reach those devices again.

---

## Build profiles summary

| Profile | Output | Use for |
|---------|--------|--------|
| `development` | APK | Local dev with Expo Go / dev client |
| `preview` | APK | Internal testing, share directly |
| `production` | AAB | Play Store releases |

---

## Secrets & signing

- EAS automatically generates and stores the Android keystore on first production build.
- **Critical:** Download and back up the keystore from the EAS dashboard (Setup → Credentials). Losing it means you cannot update the Play Store app.
- Never commit `google-service-account.json` to git.

## Push notifications (screen-offline alerts)

The app registers the phone's Expo push token against the signed-in store
(`lib/notifications.ts` → `POST /api/stores/push-token`). The server pushes
"screen offline" / "back online" alerts to it from `src/lib/device-alerts.ts`
via Expo's push API — no server-side FCM key needed.

**One-time Android delivery prerequisite (without this, token registration
succeeds but no notification ever arrives):**

1. In the Firebase console (the same ALIVE project the TV player uses is fine),
   add an Android app with package `com.partner.alive` and download its
   `google-services.json` into `store-app/`.
2. Reference it in `app.json`: `"android": { "googleServicesFile": "./google-services.json", ... }`.
3. Upload the FCM V1 service-account key to EAS so Expo's push service may send
   through your Firebase project: `npx eas credentials` → Android →
   `com.partner.alive` → Google Service Account → "Set up FCM V1".
4. Rebuild the APK (`npm run build:android`). Expo Go cannot receive remote
   push on Android SDK 52+ — only EAS builds can.

Test end-to-end: sign in on a physical device, accept the notification
permission, then from the studio repo run the sender directly against the
store's id, or use Expo's push tool (https://expo.dev/notifications) with the
token from the `PushSubscription` row.
