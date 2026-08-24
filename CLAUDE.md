# ALIVE Advertising Platform — CLAUDE.md

## Project Overview

**ALIVE** (wearealive.in) is a kirana store digital advertising network based in Mangaluru, Karnataka.
- **Brands** — pay to run ad campaigns on screens inside kirana stores
- **Kirana store owners (Store Partners)** — host a free ALIVE screen and earn ₹500 + electricity/month
- **Shoppers** — see deals/offers at their local kirana store

**Company:** VS Collective LLP · GST 29AAXFV2589C1ZE · LLP IN-KA43598411418020V  
**Contact:** hello@wearealive.in · +91 74113 24448  
**Address:** #13 First Floor Highland Manor, Falnir, Mangalore 575002

---

## How Claude Should Work on This Project

### Plan before building
For any task with 3+ steps or architectural decisions: think through the full approach first, identify affected files, consider edge cases, then implement. If something goes sideways mid-task, stop and re-plan rather than patching forward.

### Verify before done
Never mark a task complete without proving it works. Always run `npx tsc --noEmit` and `npm run build` after changes. If they fail, fix before committing. Ask: "Would a staff engineer approve this?"

### Fix bugs autonomously
When given a bug report: find the root cause, fix it, verify. No hand-holding needed. Point at logs and errors, resolve them.

### Keep changes minimal
Touch only what the task requires. No cleanup, refactoring, or added abstractions beyond scope. Three similar lines is better than a premature abstraction.

### Demand elegance on non-trivial changes
Before presenting work, ask: "Is there a more elegant way?" If a fix feels hacky, implement the clean solution. Skip for simple obvious fixes.

### Self-improve after corrections
If the user corrects a mistake, identify the pattern and avoid it for the rest of the session. Common traps on this codebase: wrong auth mechanism for store partners, proxying R2 uploads through Next.js, module-level Redis instantiation.

---

## Architecture

ALIVE is **one Next.js app** that does everything:
- Marketing site (`/`, `/store`, `/blog`, etc.)
- Brand onboarding + dashboard
- Store partner registration + dashboard
- Admin console for fleet management (`/admin` — Screens, Content, Playlists, Schedules, Reports, Monitoring tabs)
- Device/player API for Android TV apps (`/api/device/*`)

The only separate codebase is **ALIVE-Player** (Kotlin Android TV APK).

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 App Router |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives) |
| Animations | Framer Motion 11 (enter animations only — no loops) |
| Auth | Auth.js v5 (`next-auth@beta`) + Prisma adapter. Store partners: phone+password Credentials. Brands/admin: email magic-link. |
| DB | Prisma 6 + Neon PostgreSQL. Pooled `DATABASE_URL` for runtime; direct `DATABASE_DIRECT_URL` for migrations. |
| Cache | Upstash Redis — lazy `getRedis()` pattern only, never module-level |
| Media | Cloudflare R2 via AWS SDK. Browser → server-side proxy (`/api/admin/r2-upload`) → R2. Never direct browser PUT (CORS). |
| Payments | Razorpay (brand campaigns) |
| Maps | Plain Leaflet + CartoDB Voyager tiles (no react-leaflet — React 19 only) |
| Geocoding | OpenStreetMap Nominatim |
| AI | Genkit + Google AI (Gemini 2.5 Flash) |
| React | 18.3.1 — NOT 19 |

---

## Critical Conventions — Read These First

**Auth — the biggest trap:**
- Store partners (web): next-auth Credentials — the dashboard login calls `signIn('phone-password')`, which sets a session cookie. `localStorage` key `alive_store_session` is a *cache* of the store payload for instant render, and the fallback when no cookie exists yet (fresh registration, admin open-as-partner).
- Store-partner API routes: authenticate with `resolveStoreId()` from `src/lib/store-partner-auth.ts`. A bare `storeId` param is NOT a credential (ids are publicly enumerable) — an explicit `storeId` is honored only with a matching signed `x-store-token` header (HMAC, `AUTH_SECRET`; minted by login/registration//api/stores/me, or `/api/admin/store-token` for impersonation) or when it matches the next-auth session owner's store. No `storeId` → next-auth session fallback (web). Don't hand-roll `auth()` checks in these routes.
- Admin routes: `admin-password` header checked against `ADMIN_PASSWORD` env var
- Brands/admin: next-auth session via `auth()`

**R2 uploads — two paths, pick by size:**
- **Admin content (images/video, up to 100 MB): presigned PUT, browser → R2 directly.**
  `GET /api/admin/r2-upload?key=&type=` returns `uploadUrl`, then the browser PUTs the
  bytes. Required because Vercel caps a function's *request body* at ~4.5 MB on every
  plan — anything proxied through a function cannot exceed it, and no plan upgrade helps.
  Depends on bucket CORS allowing PUT from the admin origin — see `docs/R2_CORS.md`.
  The signature covers `Content-Type`, so the PUT must send the same value that was signed.
- **Small server-side uploads (KYC docs etc.): `POST /api/admin/r2-upload` proxy.** Stays
  as-is — phone photos are far under the cap and this needs no CORS.
- `maxDuration = 60` on the proxy route

**Redis:**
- Never `const kv = new Redis(...)` at module level — breaks SSG
- Always: `function getRedis() { if (!process.env.UPSTASH_...) return null; return new Redis({...}); }`

**Components:**
- `'use client'` must be first line of any file using hooks, browser APIs, or Framer Motion
- `import { db } from '@/lib/db'` — never `new PrismaClient()`
- No react-leaflet — use `async function loadLeaflet()` dynamic import pattern
- Always `// eslint-disable-next-line @next/next/no-img-element` before `<img>` tags

---

## Key File Paths

```
src/app/page.tsx                          — homepage
src/app/store/page.tsx                    — store registration
src/app/store-dashboard/page.tsx          — store partner dashboard
src/app/brand-onboarding/page.tsx         — brand onboarding
src/app/admin/page.tsx                    — admin panel (tab router)
src/app/api/device/claim/route.ts         — device first-boot JWT
src/app/api/device/events/route.ts        — proof-of-play ingestion
src/app/api/device/plan/route.ts          — 72h schedule window
src/app/api/devices/route.ts              — fleet list
src/app/api/cron/device-health/route.ts   — offline detection + alerts
src/app/api/playlists/[id]/route.ts       — PATCH (update items) + DELETE
src/app/api/admin/r2-upload/route.ts      — server-side R2 proxy upload
src/lib/db.ts                             — Prisma singleton
src/lib/r2.ts                             — Cloudflare R2 helpers
src/lib/notify.ts                         — notifyAdminWA(), notifyStoreWA()
src/lib/telemetry.ts                      — recordError(), correlation IDs
src/lib/backend-api.ts                    — typed fetch wrappers for all internal APIs
src/lib/with-api-handler.ts               — HOF: telemetry + correlationId on API routes
prisma/schema.prisma                      — full DB schema
ALIVE_PLAYER_API.md                       — Android player integration guide
```

---

## Database Models

| Model | Purpose |
|-------|---------|
| `User` | All humans. `role` enum: `STORE_PARTNER \| BRAND \| AGENCY \| ADMIN \| OPS`. Holds `phone`, `passwordHash`. |
| `Account / Session / VerificationToken` | Auth.js standard. |
| `Store` | Kirana store profile. Map coords, referral code, gstin. |
| `Brand` | Brand profile. `walletPaise` BigInt (T2). |
| `Campaign` | Brand campaign + Razorpay order. `status`: `upcoming \| pending_payment \| trial \| active \| completed` — `active` set only by verify-payment; ₹0 bookings are normalised to `trial`. |
| `Coupon` | Brand-onboarding discount codes. `FLAT` (₹ off subtotal) or `PERCENT`, optional `expiresAt` / `maxRedemptions`. Managed in Admin → Coupons; validated server-side. |
| `Device` | Physical screen. `hardwareKey` from Android. `groupName` for group scheduling. |
| `Content` | Media file. `objectKey` = R2 path. `md5` for player cache invalidation. |
| `Playlist` + `PlaylistItem` | Ordered content list with per-item duration. |
| `Schedule` | Playlist → devices or groupName, with optional dayparting. |
| `PlayEvent` | Proof-of-play row. `tag` = campaign attribution. |
| `Bill` + `BillItem` | VoiceBill POS billing. `billRef` = "ALIVE-XXXXXX". |
| `Customer` | Bill customer. Token-based auth (randomUUID → localStorage `alive_customer`). |
| `Flyer` | Store offer flyers. |
| `AuditLog` | T2 audit trail (reserved). |

---

## Key Routes

| Route | Description |
|-------|-------------|
| `/` | Marketing homepage |
| `/store` | Store partner registration |
| `/store-dashboard` | Store partner dashboard (overview / earnings / flyers / voicebill tabs) |
| `/store-agreement` | VS Collective LLP store partner contract |
| `/brand-onboarding` | Brand campaign onboarding + Razorpay |
| `/admin` | Admin panel (stores / flyers / campaigns / screens / content / playlists / schedules / reports / monitoring / payments / site-media / roadmap) |
| `/bill/[billRef]` | Public receipt — customer can claim bill |
| `/customer-dashboard` | Customer purchase history + local offers |
| `/deals` | Shopper deals page |

---

## Store Partner Auth Flow

- Web login: next-auth `signIn('phone-password')` (Credentials provider) sets the session cookie, then the dashboard fetches `/api/stores/me` and caches the store payload in `localStorage` key `alive_store_session`
- Registration saves the payload to localStorage immediately — no cookie yet; the dashboard runs from this cache until the first real login
- Mobile app (`store-app/`): no cookies — calls store APIs with an explicit `storeId` param plus the signed `x-store-token` header (`authHeaders()` in `store-app/lib/api.ts`); the token comes from `/api/stores/login` and is refreshed by every `/api/stores/me` fetch, persisted in SecureStore with the session
- `/api/stores/login` is the credential-check route used by the mobile app; the web form uses next-auth instead
- Session/cache shape: `StoreSession` in `shared/store-types.ts` (no password stored)

**Business rules:**
- Fixed ₹500/month per screen (clause 3.3 of agreement)
- Electricity reimbursed separately
- 1 screen per store only — no screen count selectors
- Referral reward: ₹500 per new partner who uses code
- Payout within 10 working days of month end
- ALIVE exclusivity within 200m of partner store

---

## Store Registration Flow

1. **Step 1** — Store name, owner name, WhatsApp (= username), password (min 6 chars), GSTIN (optional), Leaflet map, locality/pincode/city autofill via Nominatim, referral code
2. **Step 2** — Agreement preview, party block prefilled, "I agree" checkbox, submit → generates referral code + saves `agreedAt`

Form data persisted to `sessionStorage('alive_store_draft')` so navigating to agreement page and back doesn't lose data.

---

## Admin Dashboard

- Protected by `admin-password` header vs `ADMIN_PASSWORD` env var
- `sessionStorage.getItem('alive_admin_pw')` in browser for API calls
- Tabs: Dashboard | Flyers | Stores | Products | Campaigns | Payments | Coupons | Screens | Content | Programming | Slot inventory | Compositions | Layouts | Reports | Monitoring | Media | Alerts | Platform Map

---

## Design Conventions

**Never:**
- Neon colours, glowing buttons, rainbow palettes
- Floating orbs, blobs, decorative shapes in backgrounds
- Heavy gradients for decoration
- Glassmorphism / heavy backdrop-blur
- Looping or attention-seeking animations

**ALIVE visual language:**
- Primary red: `#ef4444` / `#b91c1c` — CTAs and key labels only
- Backgrounds: `bg-white` or `bg-gray-50` / `bg-background`
- Cards: white + `border border-border` — no shadow stacks
- Headings: `tracking-tight`, `font-black` for hero numbers
- Positive/savings: `text-green-700` on `bg-green-50`
- Framer Motion: enter animations only (`fadeUp`, `stagger`)

---

## Brand Onboarding

- Flow: welcome → brand details → campaign setup (screens, duration, start date) → terms of service → payment (Razorpay | Confirm Booking — Pay later | trial via `?trial=1`)
- Self-serve bounds: screens 1–50, months 1–12 — enforced in the UI stepper AND server-side (`create-order`, `campaigns/save`). Bigger deals go through sales.
- Volume tiers: ₹799 (1) / ₹699 (3+) / ₹599 (10+) / ₹549 (20+) per screen per month; GST 18% on the discounted subtotal
- Coupons are `Coupon` DB rows, managed in Admin → Coupons — no hardcoded codes. UI preview via `/api/coupons/validate`; `create-order` recomputes the discount server-side, so the browser's total is never trusted. Live code: `GETALIVENOW` = FLAT ₹100 off subtotal (no expiry/cap).
- Trials (`?trial=1`): once per email — the guard counts `status: 'trial'` and legacy ₹0 rows. Saved with `status: 'trial'`, `totalAmount: 0`; any ₹0 booking is normalised to `trial` by `campaigns/save`. Trial done-page tells brands to email creatives to their AM (no payment gate).
- Paid bookings: `verify-payment` checks the Razorpay signature, then fetches the order back from Razorpay and stores **its** amount as `totalAmount` — the client-sent total is display-only. Only `verify-payment` can set `status: 'active'`; `campaigns/save` accepts `upcoming | pending_payment | trial` only.
- Company name shown to brands is **VS Collective LLP** everywhere (Razorpay checkout displays "ALIVE") — don't reintroduce "Alive Media" / "Alive Advertising Solutions"

---

## Redis Data Model (legacy, migrating to Postgres)

```
stores:index   → string[]       # store IDs
store:{id}     → StoreInfo JSON
flyers:index   → string[]       # flyer IDs
flyer:{id}     → Flyer JSON     # includes base64 image
campaigns:all  → Campaign[]
```

---

## Env Vars

```
DATABASE_URL                    # Neon pooled (runtime)
DATABASE_DIRECT_URL             # Neon direct (migrations)
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
NEXT_PUBLIC_RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
R2_ENDPOINT
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE
AUTH_SECRET
ADMIN_PASSWORD
TWILIO_ACCOUNT_SID              # WhatsApp alerts (optional — no-op if absent)
TWILIO_AUTH_TOKEN
ADMIN_WHATSAPP                  # default +917411324448
RESEND_API_KEY                  # email alerts (optional)
MSG91_AUTH_KEY                  # MSG91 account auth key (WhatsApp OTP; falls back to Twilio WhatsApp if absent)
MSG91_WHATSAPP_NUMBER           # MSG91 integrated (sender) WhatsApp business number
MSG91_WHATSAPP_OTP_TEMPLATE     # approved WhatsApp authentication template name (body + copy-code button)
MSG91_WHATSAPP_NAMESPACE        # WhatsApp template namespace (optional, if your WABA requires it)
MSG91_WHATSAPP_LANG             # WhatsApp template language code (default en_US)
PLAYER_LATEST_VERSION_CODE      # ALIVE Player OTA — latest released versionCode (optional)
PLAYER_LATEST_VERSION_NAME      # ALIVE Player OTA — latest released versionName (optional)
PLAYER_APK_URL                  # ALIVE Player OTA — signed APK download URL (optional)
PLAYER_APK_SHA256               # ALIVE Player OTA — APK checksum for verification (optional)
PLAYER_OTA_MANIFEST_URL         # ALIVE Player OTA — latest.json manifest URL; overrides the default sideload-latest GitHub Release location. Env vars above win over the manifest (pin/rollback).
NEXT_PUBLIC_EXPO_PREVIEW_URL    # Admin Dashboard → "Store app" QR target (EAS build link or exp:// URL, optional)
PREMIUM_SIGNUP_KEY              # secret for the gated premium store signup link /store?premium=<key> (optional)
PREMIUM_MONTHLY_PAISE           # premium store monthly remuneration in paise (default 100000 = ₹1000)
EWELINK_APP_ID                  # eWeLink OAuth app (dev.ewelink.cc) — Sonoff smart plug power control (optional)
EWELINK_APP_SECRET              # eWeLink OAuth app secret; whitelist <site>/api/ewelink/callback in the app settings
```

---

## Development Branch

Active: `claude/build-alive-advertising-platform-tlG96`  
Merge to `main` → auto-deploys to Vercel.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
