# ALIVE Field Trial Runbook

Operational reference for the ~10-screen Karnataka ELEVATE T1 field trial. Written for
whoever is on call — assume no prior context beyond this doc.

## 1. Provisioning a new screen (box to playing content)

1. **Unbox and connect.** Power the Android TV device, connect the data SIM/Wi-Fi, and
   let it boot fully.
2. **First boot claims the device.** On first launch the player calls
   `POST /api/device/claim` with its hardware key and receives a per-device JWT
   (90-day expiry) plus a 6-character pairing code shown on screen.
   - If a `storeReferralCode` was set at provisioning time, the device auto-links to
     that store.
3. **Confirm pairing in admin.** In `/admin` → Screens tab, find the device by its
   pairing code (status `PENDING`) and confirm it. This sets `pairedAt` and clears the
   code from the screen.
4. **Assign a schedule.** Screens tab → assign a playlist via a Schedule (by device,
   group, store, or city). The player polls `/api/device/plan` (every 15 min) for the
   72-hour rolling window; first fetch happens immediately after pairing, no need to
   wait.
5. **Verify content is playing.** Use the Screens tab → **Diagnose** button
   (`/api/admin/devices/[id]/plan-preview`) to see exactly what plan the device should
   be receiving, including any drift between what's assigned and what the player last
   fetched.
6. **Confirm proof-of-play.** Within a few minutes of content playing, `PlayEvent`
   rows should appear for that device in the Reports tab. If nothing shows up after
   10+ minutes of confirmed playback, treat it as a P0 — proof-of-play is the grant
   deliverable.

## 2. Diagnosing a dark screen remotely

1. **Check status in admin** (Screens or Monitoring tab). A device shows OFFLINE once
   `lastSeen` is more than 20 minutes old (device-health cron runs every 5 min, see
   `src/app/api/cron/device-health/route.ts`).
   - **Known limitation:** the player's heartbeat is an Android WorkManager
     `PeriodicWorkRequest`, which the OS clamps to a 15-minute minimum interval
     regardless of what's requested. Expect up to ~20-25 minutes of lag between an
     actual outage and the admin console reflecting it. This is a platform floor, not
     a bug to chase further.
2. **Check for an open remediation ticket.** The cron auto-creates one
   (`RemediationTicket`, visible via the alerts/roadmap tooling) when a device misses
   3 heartbeat windows, has repeated offline transitions, or its 30-day uptime drops
   sharply. An admin WhatsApp alert fires at the same time (`notifyAdminWA`).
3. **Narrow down the cause, in order of likelihood:**
   - **SIM/network:** call the store, ask them to check the router/SIM signal light.
     Power-cycling the device is the fastest first move.
   - **Power cut:** the player has `RECEIVE_BOOT_COMPLETED` wired (`BootReceiver`) and
     is registered as the device's HOME app, so it should relaunch itself
     automatically once power returns — no manual restart needed in most cases.
   - **App crash:** as of this audit, an uncaught exception is caught by
     `AliveApplication`'s global handler, logged locally as an `Incident` row, and the
     process is force-restarted immediately (relies on the HOME-relaunch to bring the
     UI back). There's currently no remote way to pull that `Incident` log without
     physical/ADB access to the device — if a screen crash-loops, this is the gap to
     escalate (see "Residual risks" in the audit report).
   - **Content/plan issue:** use the Diagnose panel (step 5 above) to rule out a
     malformed or empty schedule before assuming a hardware fault.
4. **Escalate to a site visit** only after ruling out the above — for a 10-screen
   trial, a manual power-cycle call to the store owner resolves the large majority of
   "screen went dark" cases within minutes.

## 3. Rolling back a bad content push

1. **Identify the bad Schedule/Playlist** in the admin Playlists/Schedules tab.
2. **Revert the playlist items** via `PATCH /api/playlists/[id]` (the admin UI's
   playlist editor does this) — restore the previous item list/order. There is no
   automatic versioning, so know what the previous good state was before editing (the
   Diagnose panel's plan preview is a good source if you're unsure).
3. **Force an immediate resync** instead of waiting for the next 15-minute poll: use
   the **Force Sync** action on the affected device(s)
   (`POST /api/devices/[id]/force-sync`), which sets `forceSyncAt` and changes the
   plan hash so the player picks up the change immediately rather than only on
   detecting a `planHash` diff at its next scheduled poll.
4. **Verify** via the Diagnose panel that the device's plan now matches the intended
   state, then confirm visually (or via a store WhatsApp check-in) that the screen is
   showing the corrected content.
5. If content itself (not just ordering/schedule) was bad — e.g. a corrupted or wrong
   media file — delete/replace the `Content` row via the Content tab; the player
   checksum-verifies (md5/sha256) every asset before marking it playable, so a
   corrupted upload will fail to play rather than silently corrupt-render, but it
   won't self-heal until you replace the source file.

## 4. Known trial-scale limitations (not bugs, just scope)

- No remote crash-log retrieval — local `Incident` table only, cleared by the
  in-app "reset device" debug action. Fine for 10 screens with phone-based
  troubleshooting; would need real work before scaling further.
- No Sentry/Crashlytics in any of the three apps. The studio backend has its own
  lightweight telemetry (`recordError`/`TelemetryEvent` table with correlation IDs)
  wired into most API routes, which covers backend-side failures adequately for this
  scale.
- Store partner Expo app has no explicit offline/connectivity banner — it fails
  silently and falls back to last-known-good cached data on fetch errors. Adequate
  for the trial; not a proof-of-play risk since the partner app doesn't touch
  playback or event ingestion.
