# ALIVE Player — Device API Reference

**Base URL:** `https://wearealive.in`  
**API version:** v1 (path prefix `/api/device`)  
**Audience:** Android developers building the ALIVE-Player APK for Android TV

---

## Table of Contents

1. [Authentication](#authentication)
2. [Endpoints](#endpoints)
   - [POST /api/device/claim](#post-apideviceclaim)
   - [GET /api/device/plan](#get-apideviceplan)
   - [POST /api/device/events](#post-apideviceevents)
   - [GET /api/device/update-check](#get-apideviceupdate-check)
3. [Data Types](#data-types)
4. [Error Codes](#error-codes)
5. [Polling & Timing](#polling--timing)
6. [Content Playback Logic](#content-playback-logic)
7. [Local Storage](#local-storage)
8. [Boot Sequence Diagram](#boot-sequence-diagram)
9. [ALIVE Player Integration Checklist](#alive-player-integration-checklist)

---

## Authentication

All endpoints except `/api/device/claim` require a Bearer JWT in the `Authorization` header.

```
Authorization: Bearer <token>
```

The token is issued by `/api/device/claim` and is long-lived (no expiry). Tokens are rotated by re-calling claim with the same `hardwareKey`.

**Token storage:** persist both `deviceId` and `token` in `SharedPreferences` after the first successful claim. Do not re-claim on every boot unless a `401` is received.

---

## Endpoints

### POST /api/device/claim

Called **once on first boot** to register the device and obtain a JWT. Subsequent calls with the same `hardwareKey` are idempotent — the same `deviceId` is returned with a fresh token.

**Request**

```
POST https://wearealive.in/api/device/claim
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hardwareKey` | `string` | Yes | `Settings.Secure.ANDROID_ID` |
| `name` | `string` | No | Human-readable screen label (e.g. "Sharma Kirana - Counter") |
| `groupName` | `string` | No | Group tag for schedule targeting (e.g. "mangaluru-zone-1") |
| `storeReferralCode` | `string` | No | If set on first boot, the device is auto-linked to the store with this referral code. Recommended: show a one-time setup screen on the APK asking the staff to type their 6-char store referral code printed on the partner sticker. If unknown, omit the field — admin can link via the dashboard later. |

**curl example**

```bash
curl -X POST https://wearealive.in/api/device/claim \
  -H "Content-Type: application/json" \
  -d '{
    "hardwareKey": "a1b2c3d4e5f60718",
    "name": "Sharma Kirana - Counter",
    "groupName": "mangaluru-zone-1"
  }'
```

**Response `200 OK`**

```json
{
  "deviceId": "clx7k2m0f0000abc1def23456",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | `string` | Stable Prisma CUID for this device |
| `token` | `string` | Long-lived JWT for all subsequent API calls |

**Kotlin data classes**

```kotlin
data class ClaimRequest(
    val hardwareKey: String,
    val name: String? = null,
    val groupName: String? = null
)

data class ClaimResponse(
    val deviceId: String,
    val token: String
)
```

**Notes**
- The device starts in status `PENDING` until an admin assigns a schedule.
- If the device already exists, a fresh token is issued and the previous token is invalidated.

---

### GET /api/device/plan

Returns the current playback plan for this device: content items to download and a timeline of schedule windows.

**Request**

```
GET https://wearealive.in/api/device/plan
Authorization: Bearer <token>
```

No request body.

**curl example**

```bash
curl https://wearealive.in/api/device/plan \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response `200 OK`**

```json
{
  "planHash": "sha256-abc123def456",
  "scheduleId": "clx7k2m0f0000sch1234abcd",
  "validUntil": "2026-05-25T18:30:00.000Z",
  "forceSyncAt": "2026-05-20T11:42:30.000Z",
  "items": [
    {
      "contentId": "clx7k2m0f0000cnt1234abcd",
      "objectKey": "content/brand-promo-30s.mp4",
      "url": "https://r2.wearealive.in/content/brand-promo-30s.mp4",
      "md5": "d41d8cd98f00b204e9800998ecf8427e",
      "type": "VIDEO",
      "durationMs": 30000,
      "order": 1,
      "hevcUrl": "https://r2.wearealive.in/content/brand-promo-30s-hevc.mp4",
      "hevcMd5": "5d41402abc4b2a76b9719d911017c592",
      "width": 1080,
      "height": 1920
    },
    {
      "contentId": "clx7k2m0f0000cnt5678efgh",
      "objectKey": "content/store-offer-banner.jpg",
      "url": "https://r2.wearealive.in/content/store-offer-banner.jpg",
      "md5": "098f6bcd4621d373cade4e832627b4f6",
      "type": "IMAGE",
      "durationMs": 8000,
      "order": 2,
      "width": 1080,
      "height": 1920
    }
  ],
  "timeline": [
    {
      "scheduleId": "clx7k2m0f0000sch1234abcd",
      "priority": 1,
      "startAt": "2026-05-18T06:00:00.000Z",
      "endAt": "2026-05-18T22:00:00.000Z",
      "playlistId": "clx7k2m0f0000pls1234abcd",
      "name": "Weekday Daytime"
    }
  ],
  "overlays": [
    {
      "id": "clx7k2m0f0000ovr1234abcd",
      "name": "BBC News ticker",
      "type": "NEWS_TICKER",
      "text": null,
      "feedUrl": "https://feeds.bbci.co.uk/news/rss.xml",
      "imageUrl": null,
      "feedItems": [
        { "title": "Headline 1", "link": "https://...", "pubDate": "2026-05-20T..." }
      ],
      "position": "BOTTOM",
      "bgColor": "#000000",
      "fgColor": "#ffffff",
      "speedPxSec": 60,
      "heightPct": 8,
      "dailyStart": null,
      "dailyEnd": null,
      "requireWifi": true,
      "priority": 0
    }
  ]
}
```

**Response fields**

| Field | Type | Description |
|-------|------|-------------|
| `planHash` | `string` | SHA-256 fingerprint of the full plan. Cache locally; skip processing if unchanged. |
| `scheduleId` | `string \| null` | Active schedule ID, or `null` if no schedule is assigned. |
| `validUntil` | `string` (ISO 8601) | Hint for when to re-poll. |
| `forceSyncAt` | `string \| null` | Admin-triggered cache-bust timestamp. If the player's last cached `forceSyncAt` differs (or is older), invalidate the local content cache and re-download. |
| `items` | `ContentItem[]` | Ordered list of content to download and play, **fully flattened** — nested playlists are already expanded into play order, so a player that only reads `items` plays the correct sequence. Empty if no schedule. |
| _(slot mode)_ | — | When the device's store is in **slot mode** (a fixed loop of N 10-second ad slots, sold by loop position + date), `items` is that loop in position order and each item additionally carries `slotPosition` (0-based) and `isFiller` (true = a bonus/house play in an unsold position). `timeline` holds a single window covering the store's open hours for the day; closed days return no items. The player must echo `slotPosition`/`isFiller` back on the matching proof-of-play event. |
| `nested` | `NestedNode[]` | Optional playlist tree for the active schedule. Present when the scheduled playlist nests other playlists (Master → Internal). Entries are either `{ "kind": "content", ...ContentItem }` or `{ "kind": "playlist", "playlistId", "name", "items": NestedNode[] }` (max depth 3). Semantics: a nested playlist plays **all** its items per visit (SMIL `<seq>`-in-`<seq>`), so depth-first traversal of `nested` equals `items`. Players that don't understand it can ignore it. |
| `timeline` | `TimelineSlot[]` | Schedule windows with dayparting boundaries. |
| `overlays` | `Overlay[]` | Active overlays (tickers / banners / news feeds) to render on top of content. May be empty. |

**ContentItem fields**

| Field | Type | Description |
|-------|------|-------------|
| `contentId` | `string` | Stable content ID |
| `objectKey` | `string` | R2 object path (for logging/debugging) |
| `url` | `string` | Pre-signed or public download URL |
| `md5` | `string` | MD5 hex of the file — use to skip re-download |
| `type` | `"IMAGE" \| "VIDEO"` | Media type |
| `durationMs` | `number` | Display duration in milliseconds |
| `order` | `number` | Sort order for playlist (ascending) |
| `hevcUrl` | `string` (optional) | Download URL for an HEVC/H.265 rendition of the same video, when one exists. Present only for `VIDEO` items that have been (re-)transcoded since this field was added. |
| `hevcMd5` | `string` (optional) | MD5 hex of `hevcUrl`'s file. Always present alongside `hevcUrl`. |
| `width` | `number` (optional) | Intrinsic pixel width. Present for images measured in-browser at upload and videos that have been transcoded; absent for legacy uploads. Lets the player pick a scale mode (fill vs letterbox) before the file is downloaded/decoded. |
| `height` | `number` (optional) | Intrinsic pixel height. Present exactly when `width` is. |

**Choosing between `url` and `hevcUrl`:** most devices should just use `url`/`md5` (H.264 —
universally hardware-decodable across the fleet). Only prefer `hevcUrl`/`hevcMd5` when the
device's hardware H.264 decoder is unreliable (so playback would otherwise fall back to a
CPU-bound software decoder) *and* the device has a working hardware HEVC decoder — e.g. by
probing `MediaCodecList`/`MediaCodecInfo.isHardwareAccelerated()` for both codecs at runtime,
the way `DecoderCapabilities.preferHevc()` does in the reference Kotlin client. This is a
per-device runtime decision, not something the server can determine from the request.

**TimelineSlot fields**

| Field | Type | Description |
|-------|------|-------------|
| `scheduleId` | `string` | ID of the schedule this slot belongs to |
| `priority` | `number` | Higher priority slot preempts lower when windows overlap |
| `startAt` | `string` (ISO 8601) | UTC start of this schedule window |
| `endAt` | `string` (ISO 8601) | UTC end of this schedule window |
| `playlistId` | `string` | Playlist driving this window |
| `name` | `string` | Human-readable schedule name |

**Overlay fields**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Overlay ID |
| `name` | `string` | Admin-defined name (logging only) |
| `type` | `"TICKER" \| "NEWS_TICKER" \| "BANNER" \| "INFO_BAR"` | Render mode |
| `text` | `string \| null` | Used by `TICKER` and `INFO_BAR` |
| `feedUrl` | `string \| null` | Used by `NEWS_TICKER` (informational — items are pre-fetched server-side into `feedItems`) |
| `imageUrl` | `string \| null` | Used by `BANNER` |
| `feedItems` | `{ title, link, pubDate }[] \| null` | Pre-fetched headlines (cached 5 min server-side). Scroll concatenated titles. |
| `position` | `"TOP" \| "BOTTOM" \| "LEFT" \| "RIGHT"` | Where the strip renders |
| `bgColor`/`fgColor` | `string \| null` | Hex colours. Fall back to black bg / white fg if null. |
| `speedPxSec` | `number` | Scroll speed for tickers (px/sec) |
| `heightPct` | `number` | Strip thickness as % of screen height (TOP/BOTTOM) or width (LEFT/RIGHT) |
| `dailyStart`/`dailyEnd` | `string \| null` | Optional "HH:MM" dayparting in device local time |
| `requireWifi` | `boolean` | If true, hide overlay when device isn't on WiFi |
| `priority` | `number` | If multiple overlays compete for the same edge, higher wins; remaining ones stack along available edges or skip |

**Player rendering notes for overlays:**
- `TICKER` / `NEWS_TICKER` — render a single-line marquee scrolling right-to-left at `speedPxSec`. For `NEWS_TICKER`, join `feedItems[].title` with `   •   `.
- `BANNER` — render `imageUrl` as object-fit:cover within the strip box.
- `INFO_BAR` — render `text` centred, no scrolling.
- Don't render overlays while the player is in setup/onboarding state.
- Respect `dailyStart`/`dailyEnd` in **device local time**, not UTC.
- Cache `feedItems` locally between polls — they're already cached server-side so a stale value for up to 5 min is expected.

**Force sync behaviour:**
- Each plan response now includes `forceSyncAt`. Cache it alongside the plan.
- On every plan fetch, compare the new `forceSyncAt` against the cached one. If the new value is **strictly newer** (or the cached one is missing), invalidate the local content cache (purge MD5-keyed files) and re-download everything from scratch.
- This lets admins force a refresh from the Screens tab when content was updated mid-cycle.

**Side effects:** calling this endpoint updates the device's `lastSeen` timestamp and sets status to `ONLINE`.

**Kotlin data classes**

```kotlin
data class PlanResponse(
    val planHash: String,
    val scheduleId: String?,
    val validUntil: String,
    val items: List<ContentItem>,
    val timeline: List<TimelineSlot>
)

data class ContentItem(
    val contentId: String,
    val objectKey: String,
    val url: String,
    val md5: String,
    val type: ContentType,
    val durationMs: Long,
    val order: Int
)

enum class ContentType { IMAGE, VIDEO }

data class TimelineSlot(
    val scheduleId: String,
    val priority: Int,
    val startAt: String,
    val endAt: String,
    val playlistId: String,
    val name: String
)
```

---

### POST /api/device/events

Submits a batch of proof-of-play events. Each event records a single content item that was displayed. The `id` field is client-generated and used for server-side deduplication — safe to retry.

**Request**

```
POST https://wearealive.in/api/device/events
Content-Type: application/json
Authorization: Bearer <token>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `events` | `PlayEventInput[]` | Yes | Batch of play events (max 500 per request). May be empty for a telemetry-only heartbeat. |
| `telemetry` | `TelemetryInput` | No | Device health snapshot (app/Android version, free storage, playback-alive timestamp, last stall). Updates the device row. |
| `incidents` | `IncidentInput[]` | No | Locally-recorded incidents to ship to the server (max 50 per request). Each is `{ "type": "UNCAUGHT_EXCEPTION" \| "STUCK_PLAYBACK" \| "FALLBACK_TRIGGERED", "atMs": <epoch ms>, "metadata": "<stack trace or context>" }`. Stored as telemetry events (`route=player/incident`) for fleet-wide failure categorization; delete local rows only after a 2xx. |

**PlayEventInput fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (UUID v4) | Yes | Client-generated UUID — deduplication key |
| `mediaId` | `string` | Yes | `contentId` of the item that played |
| `scheduleId` | `string` | No | Active schedule at time of play |
| `campaignId` | `string` | No | Campaign attribution (from content metadata if available) |
| `tag` | `string` | No | Arbitrary tag for reporting segmentation |
| `startedAt` | `string` (ISO 8601) | Yes | UTC time playback started |
| `endedAt` | `string` (ISO 8601) | Yes | UTC time playback ended |
| `durationMs` | `number` | Yes | Actual played duration in milliseconds |
| `slotPosition` | `number` | No | Slot mode only — echo the played plan item's `slotPosition` verbatim |
| `isFiller` | `boolean` | No | Slot mode only — echo the played plan item's `isFiller`; splits guaranteed vs bonus plays in brand reporting |

**curl example**

```bash
curl -X POST https://wearealive.in/api/device/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "events": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "mediaId": "clx7k2m0f0000cnt1234abcd",
        "scheduleId": "clx7k2m0f0000sch1234abcd",
        "tag": "brand-promo-may26",
        "startedAt": "2026-05-18T08:00:00.000Z",
        "endedAt": "2026-05-18T08:00:30.000Z",
        "durationMs": 30000
      }
    ]
  }'
```

**Response `200 OK`**

```json
{
  "accepted": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `accepted` | `number` | Count of events written (duplicates excluded) |

**Side effects:** calling this endpoint updates the device's `lastSeen` timestamp and sets status to `ONLINE`.

**Kotlin data classes**

```kotlin
import java.util.UUID

data class PlayEventInput(
    val id: String = UUID.randomUUID().toString(),
    val mediaId: String,
    val scheduleId: String? = null,
    val campaignId: String? = null,
    val tag: String? = null,
    val startedAt: String,   // ISO 8601 UTC
    val endedAt: String,     // ISO 8601 UTC
    val durationMs: Long
)

data class EventsBatchRequest(
    val events: List<PlayEventInput>
)

data class EventsBatchResponse(
    val accepted: Int
)
```

---

### GET /api/device/update-check

Returns the latest released player APK version for OTA. The server resolves the
release in priority order: explicit env vars (`PLAYER_LATEST_VERSION_CODE`,
`PLAYER_APK_URL`, `PLAYER_APK_SHA256`, optional `PLAYER_LATEST_VERSION_NAME`) act
as a pin/rollback override; otherwise it reads the `latest.json` manifest the
release workflow publishes next to the APK (URL overridable via
`PLAYER_OTA_MANIFEST_URL`, default: the `sideload-latest` GitHub Release). So the
OTA target updates itself on every build with no manual env edits. The player is
responsible for comparing `versionCode` against its own `BuildConfig.VERSION_CODE`.

**Request**

```
GET https://wearealive.in/api/device/update-check
Authorization: Bearer <token>
```

**Response `200 OK`**

```json
{
  "updateAvailable": true,
  "versionCode": 14,
  "versionName": "1.0.14",
  "apkUrl": "https://media.wearealive.in/releases/alive-player-1.0.14.apk",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

If no release is configured, returns `{ "updateAvailable": false }`.

**Player behaviour:** if `versionCode > BuildConfig.VERSION_CODE`, download the
APK (reusing the same range-resume + SHA-256 verification path as content
assets), then install via `PackageInstaller`. On a Device Owner-enrolled
device running API 31+, the install is fully silent
(`SessionParams.setRequireUserAction(USER_ACTION_NOT_REQUIRED)`); on older
API levels or non-owner installs, Android shows its standard install-confirm
dialog — there is no documented silent-install path below API 31, even for
device owners.

---

## Data Types

### Device Status

| Status | Meaning |
|--------|---------|
| `PENDING` | Claimed but no schedule assigned yet |
| `ONLINE` | Successfully called plan or events within the last poll window |
| `OFFLINE` | Has not polled within the expected interval |

Status is managed server-side. The device does not set it directly.

---

## Error Codes

| HTTP Status | Code / Body | Cause | Recommended action |
|-------------|-------------|-------|-------------------|
| `400 Bad Request` | `{ "error": "..." }` | Missing or invalid fields in request body | Log error body; fix client request; do not retry automatically |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` | Missing, malformed, or expired token | Re-call `POST /api/device/claim` with the same `hardwareKey` to obtain a fresh token |
| `404 Not Found` | `{ "error": "Device not found" }` | Legacy — current endpoints answer `410` for a deleted device (see below) | Treat like `410` |
| `410 Gone` | `{ "error": "Device deleted" }` | The token is well-formed but the device row no longer exists — the screen was **deleted in the admin panel** | **Decommission:** wipe ALL local state — cached plan, downloaded media, Room tables, SharedPreferences (device id, token, FCM token) — and return to the pairing screen. Do **not** auto-re-claim: that would silently resurrect the deleted screen with its old cached content. Returned by `plan`, `events`, and `update-check`. Check for `410` **before** the `401` re-claim handling. |
| `429 Too Many Requests` | `{ "error": "Rate limited" }` | Too many requests in a short window | Back off for 60 seconds before retrying |
| `500 Internal Server Error` | `{ "error": "..." }` | Server-side failure | Retry with exponential backoff: 2s → 4s → 8s → 16s (max 4 retries) |
| `502 / 503 / 504` | — | Gateway / infrastructure issue | Same exponential backoff as 500 |

**Exponential backoff implementation (Kotlin)**

```kotlin
suspend fun <T> withRetry(maxAttempts: Int = 4, block: suspend () -> T): T {
    var delayMs = 2_000L
    repeat(maxAttempts - 1) { attempt ->
        try {
            return block()
        } catch (e: ServerException) {
            delay(delayMs)
            delayMs *= 2
        }
    }
    return block() // final attempt, let exception propagate
}
```

---

## Push Commands (FCM)

The server pushes data-only FCM messages so screens react in seconds instead of
waiting for the next poll. The player uploads its FCM token to the server and
handles these `data.type` values (`AliveMessagingService.onMessageReceived`):

| `data.type` | Action |
|---|---|
| `plan_updated` | Kick an immediate plan fetch, bypassing the poll interval |
| `decommission` | The screen was deleted in the admin panel: wipe cached plan/media/identity and return to pairing — same behaviour as an HTTP `410` |

Push is best-effort. Screens that miss a push converge through polling (plan
changes) or through the `410` answer on their next API call (deletion). Sent on
direct screen deletion (`/api/devices/bulk`) and when a store is deleted with
screens still attached.

---

## Polling & Timing

| Task | Interval | Trigger |
|------|----------|---------|
| Fetch plan (`GET /api/device/plan`) | Every **72 hours** | Also on every app start |
| Flush play events (`POST /api/device/events`) | Every **60 seconds** | Also immediately after each item plays (optional) |
| Device heartbeat | Implicit | Covered by plan poll + event flush |

**Offline behaviour**
- If the network is unavailable: continue playing cached content from local storage.
- Queue `PlayEventInput` records in a local SQLite/Room database.
- Flush the queue when connectivity is restored.
- Do not drop events — they are the basis for brand billing.

---

## Content Playback Logic

```
App start
  └─ 1. Load cached plan (SharedPreferences: plan_hash, plan_cached_at)
  └─ 2. Fetch GET /api/device/plan
       ├─ planHash == cached → skip download, proceed to step 5
       └─ planHash differs  → step 3
  └─ 3. For each item in items[]:
       ├─ Local file exists AND MD5 matches → skip download
       └─ Otherwise → download from item.url, verify MD5, store locally
  └─ 4. Persist new planHash + plan_cached_at
  └─ 5. Sort items by item.order (ascending) → build playlist
  └─ 6. Evaluate timeline[]:
       ├─ Find highest-priority TimelineSlot where now is within [startAt, endAt]
       └─ Use that slot's playlist; if no active slot → play default/fallback
  └─ 7. Loop playlist continuously
       └─ After each item:
            ├─ Create PlayEventInput (UUID, mediaId, scheduleId, startedAt, endedAt, durationMs)
            └─ Append to local event buffer
  └─ 8. Every 60s: POST /api/device/events with buffered events (up to 500), clear buffer on success
  └─ 9. Every 72h (or on wake): go to step 2
```

**Timeline boundary handling**

Poll `timeline` in a background coroutine. When the current UTC time crosses a `startAt` or `endAt` boundary, re-evaluate which `TimelineSlot` is active and switch playlists at the next natural item boundary (do not cut mid-play).

---

## Local Storage

Use `SharedPreferences` (mode `MODE_PRIVATE`, preference file name `alive_device_prefs`) for all persisted state.

| Key | Type | Description |
|-----|------|-------------|
| `device_id` | `String` | Stable device ID from claim response |
| `device_token` | `String` | Bearer JWT from claim response |
| `plan_hash` | `String` | `planHash` from last successful plan fetch |
| `plan_cached_at` | `String` (ISO 8601) | UTC timestamp of last plan fetch |

**Kotlin helper**

```kotlin
object DevicePrefs {
    private const val PREFS_NAME = "alive_device_prefs"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var deviceId: String?
        get() = prefs.getString("device_id", null)
        set(v) = prefs.edit().putString("device_id", v).apply()

    var deviceToken: String?
        get() = prefs.getString("device_token", null)
        set(v) = prefs.edit().putString("device_token", v).apply()

    var planHash: String?
        get() = prefs.getString("plan_hash", null)
        set(v) = prefs.edit().putString("plan_hash", v).apply()

    var planCachedAt: String?
        get() = prefs.getString("plan_cached_at", null)
        set(v) = prefs.edit().putString("plan_cached_at", v).apply()
}
```

Downloaded media files should be stored in `context.filesDir` (internal storage, not cleared by system). Use `contentId` as the filename (e.g. `clx7k2m0f0000cnt1234abcd.mp4`) to match against the plan without a separate index.

---

## Boot Sequence Diagram

```
Android TV App                          ALIVE Studio API
      |                                       |
      |── App starts ──────────────────────── |
      |                                       |
      |  [First boot only]                    |
      |── POST /api/device/claim ────────────>|
      |   { hardwareKey: ANDROID_ID }         |
      |<── { deviceId, token } ───────────────|
      |                                       |
      |  Store deviceId + token               |
      |  in SharedPreferences                 |
      |                                       |
      |  [Every boot]                         |
      |── GET /api/device/plan ──────────────>|
      |   Authorization: Bearer <token>       |
      |<── { planHash, items, timeline } ─────|
      |                                       |
      |  planHash == cached?                  |
      |  ├─ YES: skip to playback             |
      |  └─ NO:  download new items           |
      |     (skip if MD5 matches local file)  |
      |                                       |
      |  Build playlist (sort by order)       |
      |  Evaluate timeline for active window  |
      |                                       |
      |── [loop: play item N] ─────────────── |
      |   Enqueue PlayEventInput              |
      |                                       |
      |  [Every 60 seconds]                   |
      |── POST /api/device/events ───────────>|
      |   { events: [...] }                   |
      |<── { accepted: N } ───────────────────|
      |                                       |
      |  [Every 72 hours]                     |
      |── GET /api/device/plan ──────────────>|
      |   (repeat plan check cycle)           |
      |                                       |
      |  [On 401 response]                    |
      |── POST /api/device/claim ────────────>|
      |   { hardwareKey: ANDROID_ID }         |
      |<── { deviceId, token (rotated) } ─────|
      |  Store new token, retry request       |
      |                                       |
```

---

## ALIVE Player Integration Checklist

### Device Registration
- [ ] Read `Settings.Secure.ANDROID_ID` and store as `hardwareKey`
- [ ] On first boot (no `device_token` in SharedPreferences): call `POST /api/device/claim`
- [ ] Persist `deviceId` → `device_id` and `token` → `device_token` in SharedPreferences
- [ ] On `401` from any endpoint: re-call claim with same `hardwareKey`, store rotated token, retry

### Plan Fetching
- [ ] Call `GET /api/device/plan` on every app start
- [ ] Call `GET /api/device/plan` on a 72-hour repeating background job (WorkManager recommended)
- [ ] Compare returned `planHash` against cached `plan_hash` before downloading
- [ ] Persist `plan_hash` and `plan_cached_at` after a successful fetch

### Content Download & Cache
- [ ] Download each `ContentItem` from its `url`
- [ ] Verify downloaded file MD5 against `ContentItem.md5` before marking complete
- [ ] Skip download if a local file for `contentId` already exists and MD5 matches
- [ ] Store files in `context.filesDir` using `contentId` as the filename

### Playback
- [ ] Sort `items` by `order` (ascending) to build the playlist
- [ ] Loop the playlist continuously
- [ ] Evaluate `timeline` slots in a background coroutine; respect `priority` when windows overlap
- [ ] Switch playlists at timeline boundaries at the next natural item boundary (not mid-play)
- [ ] Handle empty `items` / no active timeline gracefully (show fallback / blank screen)

### Proof-of-Play Events
- [ ] Generate a UUID v4 client-side for each `PlayEventInput.id`
- [ ] Record `startedAt` and `endedAt` in UTC ISO 8601
- [ ] Buffer events locally (Room database recommended)
- [ ] Flush buffer via `POST /api/device/events` every 60 seconds
- [ ] Flush in batches of max 500 events per request
- [ ] Clear buffer entries only after receiving `200 OK` (not on failure)
- [ ] Persist unsent events across app restarts

### Offline & Error Handling
- [ ] On network unavailable: continue playing from local cache
- [ ] Queue events to local DB when offline; flush when online
- [ ] Implement exponential backoff for 5xx errors: 2s → 4s → 8s → 16s (4 retries max)
- [ ] On `429`: wait 60 seconds before retrying
- [ ] On `404 Device not found`: clear SharedPreferences and re-claim

### Android TV Specifics
- [ ] Request `INTERNET` and `ACCESS_NETWORK_STATE` permissions in `AndroidManifest.xml`
- [ ] Use `WorkManager` for periodic plan fetch (survives process death)
- [ ] Use `ExoPlayer` for VIDEO content and `Glide`/`Coil` for IMAGE content
- [ ] Disable screen saver / keep screen on (`FLAG_KEEP_SCREEN_ON`) for the player activity
- [ ] Handle D-pad / remote control events — suppress UI interaction in kiosk mode
- [ ] Target `android:launchMode="singleTask"` to prevent multiple player instances
