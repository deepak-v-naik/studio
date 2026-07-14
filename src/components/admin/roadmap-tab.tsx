'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Copy, CheckCircle2, MessageSquare, Zap, ChevronDown, ChevronUp, Map as MapIcon, List as ListIcon, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getDevices, type Device } from '@/lib/backend-api';

// Karnataka ELEVATE T1 grant deliverable: this many screens, each reliably
// online with proof-of-play actually flowing, not just provisioned.
const GRANT_TARGET_SCREENS = 10;
const GRANT_MIN_UPTIME_PCT = 80;
const GRANT_POP_WINDOW_MS = 24 * 60 * 60 * 1000; // proof-of-play seen in the last 24h

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = 'built' | 'in-progress' | 'planned' | 't2';
type FilterValue = 'all' | 'built' | 'in-progress' | 'planned' | 't2';

type RoadmapItem = {
  id: string;
  cluster: string;
  label: string;
  sub: string;
  status: Status;
  path?: string;
  description?: string;
  notes?: string[];
  critical?: boolean;
  claudePrompt?: string; // ready-to-paste Claude implementation prompt
};

// ─── Platform context (prepended to all copy-for-Claude actions) ──────────────

const PLATFORM_CONTEXT = `# ALIVE Platform — Claude Session Context
Repository: vanillasomethin/studio (Next.js 15 App Router)
Branch: claude/ecstatic-heisenberg-j93BW
Production: wearealive.in (Vercel auto-deploy from main)

## Stack
- Next.js 15 App Router, React 18.3.1, TypeScript
- Tailwind CSS + shadcn/ui (Radix primitives)
- Framer Motion 11 (enter animations only — no loops)
- Prisma 6 + Neon PostgreSQL (pooled DATABASE_URL at runtime, direct DATABASE_DIRECT_URL for migrations)
- Upstash Redis (lazy getRedis() pattern — never module-level)
- Cloudflare R2 via AWS SDK (signed PUT for uploads — never proxy through Next.js)
- Genkit + Google AI (Gemini 2.5 Flash) for AI features
- Auth.js v5 (next-auth@beta) with Prisma adapter — store partners use phone+password Credentials, brands use email magic-link
- Razorpay for brand campaign payments

## Key conventions
- 'use client' as first line of any component using hooks or browser APIs
- db singleton from @/lib/db — never new PrismaClient()
- localStorage key alive_store_session for store partner auth
- Admin protected by admin-password header (checked against ADMIN_PASSWORD env var)
- No react-leaflet (React 19 only) — use plain leaflet with dynamic import
- No emojis in UI unless user requests
- No neon/glow/glassmorphism — ALIVE uses clean white cards, red #ef4444 as primary, green for positive
- Cloudflare R2 uploads: browser → signed URL → R2 directly (see src/lib/r2.ts)

## Current build state (as of today)
Built (live): Homepage, Store Registration + Agreement, Brand Onboarding + Razorpay, Store Dashboard (overview/earnings/flyers/payout tabs), Admin Panel with full design system (Inter Tight + JetBrains Mono, KPI cards, live feed, ticker, ⌘K search), Admin tabs: stores/flyers/campaigns/screens/content/programming/compositions/layouts/reports/monitoring/payments/site-media/products/roadmap, Satori flyer generator (/api/generate-flyer edge route), APK sideload card, drag-drop product image upload, Device APIs (claim/events/plan/fleet), Background cron jobs (health check, context sync, external signals), Prisma schema with all models, Cloudflare R2 media storage, ALIVE_PLAYER_API.md integration guide.

In progress: WhatsApp admin alerts (notifyAdminWA exists in src/lib/notify.ts, needs wiring to health cron), Auto-remediation (route exists, not auto-triggered).

Planned T1: Full Android Player APK (SystemLauncher, WatchdogService, NTPSyncManager, ContentCache, SyncManager, PlaybackEngine, POPEmitter, TelemetryAgent).

T2 (future): Brand wallet top-up, self-serve campaign builder, per-play billing engine, audit log, remote device ops, creative moderation queue.

## Key file paths
src/app/page.tsx — homepage
src/app/store/page.tsx — store registration
src/app/store-dashboard/page.tsx — store partner dashboard
src/app/brand-onboarding/page.tsx — brand onboarding flow
src/app/admin/page.tsx — admin panel (tab router)
src/app/api/device/claim/route.ts — device first-boot JWT
src/app/api/device/events/route.ts — proof-of-play ingestion
src/app/api/device/plan/route.ts — 72h schedule window
src/app/api/devices/route.ts — fleet list
src/app/api/cron/device-health/route.ts — offline detection cron
src/lib/db.ts — Prisma singleton
src/lib/r2.ts — Cloudflare R2 helpers
src/lib/notify.ts — notifyAdminWA() WhatsApp alert
src/lib/telemetry.ts — recordError(), correlation IDs
src/lib/backend-api.ts — typed fetch wrappers for all internal APIs
prisma/schema.prisma — full DB schema
ALIVE_PLAYER_API.md — Android player integration guide (all 3 endpoints, Kotlin examples)

## MANDATORY FINAL STEP — Platform Map self-update
After every implementation task, you MUST update the Platform Map to reflect the new status.
The map lives at: src/components/admin/roadmap-tab.tsx
In the ITEMS array, find the entry whose \`id\` matches the task's Item ID (specified below each task header).
Change its \`status\` field to \`'built'\` (or \`'in-progress'\` if partially done).
Commit this change in the same commit as your implementation, or as an immediately following commit.
Commit message format: "mark [label] as built in platform map"

This is how the admin at wearealive.in/admin (Platform Map tab) knows the feature shipped.
If you skip this step, the map will show the item as planned/in-progress forever.
`;

// ─── Data ─────────────────────────────────────────────────────────────────────

const ITEMS: RoadmapItem[] = [
  // ── Marketing Site ──────────────────────────────────────────────────────────
  {
    id: 'homepage', cluster: 'Marketing Site', label: 'Homepage', sub: 'Main brand-facing marketing page',
    status: 'built', path: 'src/app/page.tsx', critical: true,
    description: 'Main marketing homepage targeting brands. Shows value proposition, store network map, pricing tiers, and CTA to brand onboarding.',
    notes: ['Leaflet map loads via dynamic import to avoid SSR issues', 'CartoDB Voyager tiles at default centre Mangaluru 12.8698N 74.8431E', 'Framer Motion stagger/fadeUp for section reveals'],
    claudePrompt: `Context: ALIVE homepage at src/app/page.tsx is live. It shows the brand-facing value proposition, an interactive Leaflet store network map (CartoDB Voyager tiles, default centre Mangaluru), and a Razorpay-backed pricing section.

Task: [DESCRIBE YOUR ENHANCEMENT HERE — e.g. "Add a testimonials section with 3 store partner quotes after the pricing section. Use the existing fadeUp/stagger Framer Motion variants. Store partner names and quotes should be hard-coded for now."]

Constraints:
- Keep 'use client' at top
- No react-leaflet — the map uses plain leaflet with dynamic import
- Follow existing fadeUp/stagger animation pattern from the file
- Colors: red #ef4444 for primary CTAs, text-muted-foreground for secondary text
- No emojis, no glassmorphism`,
  },
  {
    id: 'store-reg', cluster: 'Marketing Site', label: 'Store Registration', sub: '2-step kirana signup with map',
    status: 'built', path: 'src/app/store/page.tsx', critical: true,
    description: 'Two-step store partner registration: step 1 = store details + Leaflet map picker with GPS + GSTIN + password strength; step 2 = agreement preview + checkbox + submit. Session saved to localStorage alive_store_session.',
    notes: ['Form draft saved to sessionStorage alive_store_draft to survive navigation', 'Address autofilled via Nominatim reverse geocode on pin move', 'Referral code generated as "STORE" + random 4-char slug on submit', 'GSTIN validated against 15-char Indian format regex'],
    claudePrompt: `Context: Store registration at src/app/store/page.tsx is fully built. It's a 2-step form: step 1 collects store details + Leaflet map location, step 2 shows agreement. On submit, calls POST /api/stores/save and saves to localStorage alive_store_session.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a referral leaderboard link after successful registration showing the top 5 referring stores in the city"]

Key files:
- src/app/store/page.tsx — main form
- src/components/map-picker.tsx — Leaflet map component
- src/app/api/stores/save/route.ts — save endpoint
- prisma/schema.prisma — Store model

Follow the light theme (white/gray-50 cards), use amber for callout boxes, red for primary CTA.`,
  },
  {
    id: 'store-agreement', cluster: 'Marketing Site', label: 'Store Agreement', sub: 'Full VS Collective LLP contract',
    status: 'built', path: 'src/app/store-agreement/page.tsx',
    description: 'Rendered store partner agreement page. Party B fields (name, phone, GSTIN) are passed as URL params from registration step 2. Digital Acceptance block renders instead of witness signatures.',
    claudePrompt: `Context: Store agreement at src/app/store-agreement/page.tsx reads URL params (name, owner, address, phone, gstin) and renders VS Collective LLP contract with a Digital Acceptance block. Executed under IT Act 2000.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a 'Download as PDF' button that opens the browser print dialog with print-optimised CSS (hide header/footer, show full content)"]`,
  },
  {
    id: 'brand-onboarding', cluster: 'Marketing Site', label: 'Brand Onboarding', sub: 'Multi-step campaign flow with Razorpay',
    status: 'built', path: 'src/app/brand-onboarding/page.tsx', critical: true,
    description: '6-step wizard: welcome → brand details → campaign setup (screens, duration, date) → terms of service → payment (Razorpay or confirm-later) → done. Promo GETALIVENOW gives ₹100 off. Volume tiers: 1/3/10/20 screens.',
    notes: ['Pending campaign saved to localStorage alive_pending_campaign before Razorpay redirect', 'useSession() from next-auth — page renders loading skeleton until session resolves', 'Razorpay loaded dynamically via loadRazorpayScript() to avoid SSR issues'],
    claudePrompt: `Context: Brand onboarding at src/app/brand-onboarding/page.tsx is a 6-step wizard ending with Razorpay. Verified payment handled at src/app/api/razorpay/verify-payment/route.ts which saves campaign to DB.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a step 2.5 'Location picker' between brand details and campaign setup where the brand selects which city clusters they want (Mangaluru North / South / Central) using a multi-select. Store the selected clusters in form state and pass to campaign save API."]

Key files:
- src/app/brand-onboarding/page.tsx — wizard + all step components in one file
- src/app/api/campaigns/save/route.ts — campaign persistence
- src/app/api/razorpay/ — order creation + payment verification
- prisma/schema.prisma — Campaign model

Pattern to follow: steps are function components (StepWelcome, StepDetails, StepCampaign, StepAgreement, StepPayment, StepDone). Add new step as a new function and wire it into the step === N conditionals.`,
  },
  {
    id: 'deals', cluster: 'Marketing Site', label: 'Deals / Offers Page', sub: 'Shopper-facing deals listing',
    status: 'built', path: 'src/app/deals/',
    description: 'Public deals page for shoppers. Fetches active flyers from /api/flyers/save (GET, public). Shows card grid of store offers.',
    claudePrompt: `Context: Deals page at src/app/deals/ fetches flyers from GET /api/flyers/save and shows a card grid of offers.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a search/filter bar at the top that filters deals by category (Groceries, Dairy, Snacks, etc.). Categories should be inferred from flyer titles using a simple keyword match."]`,
  },
  {
    id: 'voicebill', cluster: 'Marketing Site', label: 'VoiceBill POS', sub: 'AI-powered billing + public receipt + customer dashboard',
    status: 'built',
    description: 'Full VoiceBill POS flow: voice/text input → Gemini AI parses items → bill saved to DB → QR links to public receipt → customer registers phone to claim bill → /customer-dashboard shows purchase history. Three new Prisma models: Bill, BillItem, Customer.',
    notes: ['Bill model uses billRef "ALIVE-XXXXXX" human-readable ID', 'Customer auth is token-based (randomUUID), saved to localStorage alive_customer', 'QR code via api.qrserver.com (no new packages)', 'Speech recognition via Web Speech API lang:en-IN'],
    claudePrompt: `Context: VoiceBill POS is planned but not yet built. The plan doc has full spec. Here's what needs to be created:

## Prisma models to add to prisma/schema.prisma
\`\`\`prisma
model Customer {
  id        String   @id @default(cuid())
  phone     String   @unique
  name      String
  token     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  bills     Bill[]
  @@index([phone])
}
model Bill {
  id          String     @id @default(cuid())
  billRef     String     @unique  // "ALIVE-XXXXXX"
  storeId     String?
  storeName   String
  totalAmount Int
  payMethod   String     @default("cash")
  status      String     @default("open")
  customerId  String?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  store       Store?     @relation(fields: [storeId], references: [id], onDelete: SetNull)
  customer    Customer?  @relation(fields: [customerId], references: [id], onDelete: SetNull)
  items       BillItem[]
  @@index([customerId])
  @@index([storeId])
  @@index([billRef])
  @@index([createdAt])
}
model BillItem {
  id     String @id @default(cuid())
  billId String
  name   String
  qty    Int
  unit   String @default("pcs")
  price  Int
  bill   Bill   @relation(fields: [billId], references: [id], onDelete: Cascade)
  @@index([billId])
}
\`\`\`
Also add \`bills Bill[]\` to the Store model.

## Files to create
1. src/components/store/voice-bill-tab.tsx — POS UI (voice mic + item table + QR + payment method + Complete Sale)
2. src/app/api/voicebill/parse/route.ts — POST, store session auth, calls Genkit ai.generate() to parse kirana items from text → {items:[{name,qty,unit,price}]}
3. src/app/api/bills/route.ts — POST creates Bill+BillItems in db.$transaction
4. src/app/api/bills/[billRef]/route.ts — GET public bill
5. src/app/api/bills/[billRef]/claim/route.ts — POST customer claims bill (upsert Customer, link bill)
6. src/app/api/customer/bills/route.ts — GET customer bill history (phone+token auth)
7. src/app/bill/[billRef]/page.tsx — public receipt page with "Save to my ALIVE account" section
8. src/app/customer-dashboard/page.tsx — customer dashboard (localStorage token auth)

## File to modify
src/app/store-dashboard/page.tsx — add 4th tab "VoiceBill" with ShoppingCart icon, render <VoiceBillTab storeId={...} storeName={...} />

## Stack/patterns
- Voice: Web Speech API, lang:'en-IN', no new packages
- QR: <img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=...">
- AI: import { ai } from '@/ai/genkit'; ai.generate({ model, prompt })
- DB: import { db } from '@/lib/db'
- No Clerk — store dashboard uses localStorage alive_store_session
- Customer auth: randomUUID() token stored in localStorage alive_customer = {phone,name,token}

Run \`npx prisma migrate dev --name add_bill_customer\` after schema changes.`,
  },

  // ── Store Dashboard ──────────────────────────────────────────────────────────
  {
    id: 'store-auth', cluster: 'Store Dashboard', label: 'Store Auth', sub: 'Phone + password, localStorage session',
    status: 'built', path: 'src/app/store-dashboard/', critical: true,
    description: 'Custom phone+password auth. No Clerk. Session stored in localStorage under alive_store_session key. Login calls POST /api/stores/login. Dashboard gate shows login form if no session.',
    notes: ['Session key: alive_store_session', 'Login: POST /api/stores/login with {phone, password}', 'No JWT — raw session object in localStorage', 'Password hashed with bcrypt in DB'],
    claudePrompt: `Context: Store dashboard auth at src/app/store-dashboard/page.tsx uses a custom login gate. localStorage key alive_store_session stores the session. POST /api/stores/login at src/app/api/stores/login/route.ts validates phone+password.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a 'Forgot Password' flow: show a phone input, send OTP via WhatsApp using notifyAdminWA, verify OTP, allow password reset. Add POST /api/stores/reset-password route."]

Key files:
- src/app/store-dashboard/page.tsx — dashboard + login gate component
- src/app/api/stores/login/route.ts — login endpoint
- src/app/api/stores/save/route.ts — registration (sets initial password)
- src/lib/notify.ts — notifyAdminWA() for WhatsApp alerts`,
  },
  {
    id: 'store-overview', cluster: 'Store Dashboard', label: 'Overview Tab', sub: 'Earnings, screen status, referral code',
    status: 'built', path: 'src/app/store-dashboard/',
    description: 'Shows monthly earnings (₹500/screen), screen health pill, referral code with share link, and referral count.',
    claudePrompt: `Context: Store dashboard overview tab is inside src/app/store-dashboard/page.tsx. Shows earnings, device status from GET /api/devices, and referral info.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a 'Month History' section below earnings showing the last 6 months of payment status (paid/pending) fetched from GET /api/stores/payments"]`,
  },
  {
    id: 'store-flyers', cluster: 'Store Dashboard', label: 'Flyers Tab', sub: 'Store-specific flyer management',
    status: 'built', path: 'src/app/store-dashboard/',
    description: 'Partner can view active flyers for their store and submit new offers via a simple form.',
    claudePrompt: `Context: Flyers tab in store dashboard at src/app/store-dashboard/page.tsx. Store partners can view and submit flyers.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a 'Schedule this offer' date picker on each flyer card so store partners can set start/end dates for their offers. Persist dates to the Flyer model (add startAt/endAt DateTime? fields to schema.prisma)."]`,
  },
  {
    id: 'store-payout', cluster: 'Store Dashboard', label: 'Payout Settings', sub: 'UPI / bank details entry',
    status: 'built', path: 'src/app/store-dashboard/',
    description: 'Store partner enters UPI ID or bank account+IFSC for monthly ₹500 payout. Saved via POST /api/stores/save (PATCH semantics). Dedicated Payout tab — no offer fields here.',
    claudePrompt: `Context: Payout settings tab in store dashboard. Saves UPI or bank details via POST /api/stores/save. Fields: upiId, bankAccountNo, bankIfsc, bankAccountName, payoutMethod.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a 'Payment history' section below the payout form showing last 3 months of StorePayment records fetched from a new GET /api/stores/payments endpoint that returns StorePayment rows for the logged-in store."]

DB: StorePayment model already in schema. Fields: id, storeId, month (YYYY-MM), amount, status (pending/paid/skipped), paidAt, utrRef.`,
  },

  // ── Admin Panel ──────────────────────────────────────────────────────────────
  {
    id: 'admin-stores', cluster: 'Admin Panel', label: 'Stores Tab', sub: 'Search, reject, delete, stage management',
    status: 'built', path: 'src/app/admin/page.tsx', critical: true,
    description: 'Full store partner CRM: search by name/city, filter by onboarding stage, payout method selector, live date setter, delete action. Fetches from GET /api/stores/save.',
    claudePrompt: `Context: Admin stores tab in src/app/admin/page.tsx. Fetches all stores from GET /api/stores/save (admin-password header). Shows search, stage filter, payout method, live date, delete.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a CSV export button that downloads all stores with columns: storeName, ownerName, whatsapp, city, status, liveAt, upiId, bankAccountNo. Use GET /api/admin/store-payments/bulk-export?month=YYYY-MM as a reference for how to build CSV download endpoints."]`,
  },
  {
    id: 'admin-flyers', cluster: 'Admin Panel', label: 'Flyers Tab', sub: 'Upload and manage flyers',
    status: 'built', path: 'src/app/admin/page.tsx',
    description: 'Admin uploads flyers via client-side Canvas compression (1200px JPEG 0.75) then POST /api/flyers/save. Also includes an auto-generate panel: pick a store + up to 9 of its active StoreOffer rows, renders a flyer via /api/generate-flyer (Satori), then publishes the same way. Shows card grid with delete action.',
    claudePrompt: `Context: Admin flyers tab in src/app/admin/page.tsx. Flyers stored in Postgres via Prisma Flyer model (or Redis legacy). Upload uses Canvas compression.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Migrate flyer image storage from Redis base64 to Cloudflare R2. On upload, use the existing R2 upload pattern from src/lib/r2.ts: get signed URL from /api/admin/r2-upload, PUT directly to R2, save the R2 object key to the Flyer model instead of base64."]`,
  },
  {
    id: 'admin-campaigns', cluster: 'Admin Panel', label: 'Campaigns Tab', sub: 'Revenue totals, paid/pending counts',
    status: 'built', path: 'src/app/admin/page.tsx',
    description: 'Displays all brand campaigns with revenue total, payment status and delete action. Fetches from GET /api/campaigns/admin.',
    claudePrompt: `Context: Admin campaigns tab in src/app/admin/page.tsx. Fetches from GET /api/campaigns/admin with admin-password header. Shows revenue totals, payment status.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a 'Mark as paid' button on each pending campaign that calls PATCH /api/campaigns/[id]/status to update status to 'active'. Add the PATCH endpoint at src/app/api/campaigns/[id]/status/route.ts."]`,
  },
  {
    id: 'admin-screens', cluster: 'Admin Panel', label: 'Screens Tab', sub: 'Fleet with schedule + play details',
    status: 'built', path: 'src/components/admin/screens-tab.tsx', critical: true,
    description: 'Full device fleet view: card per device showing online/offline status, active schedule name + end time, last play event, group name, uptime %. Claim pending devices show hardwareKey for identification.',
    notes: ['GET /api/devices returns currentSchedule + lastPlayAt per device', 'Status: ONLINE if lastSeen < 5 min, OFFLINE otherwise', 'Group-based scheduling: assign groupName to target all devices in a group'],
    claudePrompt: `Context: Screens tab at src/components/admin/screens-tab.tsx. Fetches from GET /api/devices which returns devices with currentSchedule, lastPlayAt, uptimePct. Shows card grid.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a 'Group Manager' section at the top that lists all unique groupNames across devices with a count, and lets admin reassign a device's groupName via an inline text input. PATCH /api/devices/[id] to persist groupName change."]

Key files:
- src/components/admin/screens-tab.tsx — component
- src/app/api/devices/route.ts — fleet list API (GET + handles PATCH for device update)
- src/lib/backend-api.ts — Device type definition`,
  },
  {
    id: 'admin-content', cluster: 'Admin Panel', label: 'Content Tab', sub: 'Media library with R2 upload',
    status: 'built', path: 'src/components/admin/content-tab.tsx',
    description: 'Upload images/videos to Cloudflare R2. Admin selects file → gets signed URL from /api/admin/r2-upload → PUT direct to R2 → saves metadata via POST /api/content. Library shows cards with MD5, duration, delete.',
    notes: ['R2 upload is server-side proxy via /api/admin/r2-upload (AWS SDK putObject)', 'MD5 computed client-side before upload for cache invalidation on Android player', 'Video duration extracted via HTML5 video.duration'],
    claudePrompt: `Context: Content tab at src/components/admin/content-tab.tsx. Upload flow: POST /api/content → gets {uploadUrl, objectKey} → PUT to R2 signed URL → PATCH /api/content/[id]/confirm. Content model in prisma/schema.prisma.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add drag-and-drop upload support. Multiple files should queue and upload sequentially with a progress bar per file. Show overall queue progress at the top."]

Key files:
- src/components/admin/content-tab.tsx — UI
- src/app/api/content/route.ts — create content record + signed URL
- src/app/api/admin/r2-upload/route.ts — server-side R2 putObject proxy
- src/lib/r2.ts — R2 helpers (getSignedUploadUrl, deleteObject)`,
  },
  {
    id: 'admin-playlists', cluster: 'Admin Panel', label: 'Playlists Tab', sub: 'Ordered content playlists',
    status: 'built', path: 'src/components/admin/playlists-tab.tsx',
    description: 'Create and manage playlists — ordered list of Content items with per-item durationMs. Drag-to-reorder, delete. Uses Playlist + PlaylistItem Prisma models.',
    claudePrompt: `Context: Playlists tab at src/components/admin/playlists-tab.tsx. CRUD via /api/playlists. Playlist has items with order+durationMs. PlaylistItem links to Content.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a playlist preview mode: click 'Preview' on a playlist to open a modal that cycles through the content cards at the configured durationMs, simulating how it would look on a screen."]

Key files:
- src/components/admin/playlists-tab.tsx
- src/app/api/playlists/route.ts — GET all, POST create
- src/app/api/playlists/[id]/route.ts — DELETE`,
  },
  {
    id: 'admin-schedules', cluster: 'Admin Panel', label: 'Schedules Tab', sub: 'Assign playlists to devices/groups',
    status: 'built', path: 'src/components/admin/schedules-tab.tsx', critical: true,
    description: 'Assign a playlist to specific deviceIds or a groupName. Supports once/daily/weekly recurrence. Optional daypart window (dailyStart/dailyEnd HH:MM). Schedules consumed by GET /api/device/plan.',
    notes: ['Schedule.deviceIds is String[] in Postgres — hasSome filter for overlap checks', 'GroupName assignment targets ALL devices with that group', 'Priority field on Schedule model — higher priority wins overlap'],
    claudePrompt: `Context: Schedules tab at src/components/admin/schedules-tab.tsx. CRUD via /api/schedules. Schedule model: {playlistId, deviceIds[], groupName, startAt, endAt, recurrence, dailyStart, dailyEnd, priority}. Android player fetches its plan via GET /api/device/plan?hours=72.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a 'Calendar view' toggle that switches the schedule list to a weekly grid showing which time slots are covered per device group. Highlight conflicts (two schedules overlapping for the same device/group in the same time window)."]

Key files:
- src/components/admin/schedules-tab.tsx
- src/app/api/schedules/route.ts — GET all, POST create
- src/app/api/device/plan/route.ts — how schedules translate to player plan`,
  },
  {
    id: 'admin-reports', cluster: 'Admin Panel', label: 'Reports Tab', sub: 'POP logs + CSV export',
    status: 'built', path: 'src/components/admin/reports-tab.tsx', critical: true,
    description: 'Proof-of-play event log table. Filter by deviceId, campaignId/tag, date range. CSV download at /api/events/export/csv. PlayEvent rows from Android player via POST /api/device/events.',
    notes: ['PlayEvent.tag carries campaign/brand ID for billing attribution', 'prevHash/rowHash on PlayEvent reserved for T2 tamper-evident chain', 'CSV export passes admin-password as query param (not header) for browser download link'],
    claudePrompt: `Context: Reports tab at src/components/admin/reports-tab.tsx. Fetches from GET /api/events (paginated). CSV at GET /api/events/export/csv. PlayEvent model has: deviceId, mediaId, layoutId, campaignId, startedAt, endedAt, durationMs, tag, impressions, costPaise.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a 'Campaign billing summary' view that groups play events by tag (campaign ID), sums total durationMs and impressions, calculates cost at ₹0.01/second/screen, and shows a per-campaign table with totals. Add a 'Send report' button that posts the CSV to the campaign's contact email."]`,
  },
  {
    id: 'admin-monitoring', cluster: 'Admin Panel', label: 'Monitoring Tab', sub: 'Live heartbeat grid',
    status: 'built', path: 'src/components/admin/monitoring-tab.tsx',
    description: 'Real-time device health grid. Shows ONLINE/OFFLINE state (lastSeen threshold 5 min), last heartbeat time, group, uptime %. Auto-refreshes every 30s.',
    claudePrompt: `Context: Monitoring tab at src/components/admin/monitoring-tab.tsx. Polls GET /api/devices every 30s. Shows device health grid.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add an alert banner at the top that shows the count of devices offline for more than 1 hour, with a 'Create support tickets' button that POSTs to /api/agent/remediate for each offline device to generate AI-proposed fixes."]`,
  },
  {
    id: 'admin-payments', cluster: 'Admin Panel', label: 'Payments Tab', sub: 'Per-store monthly payout tracking',
    status: 'built', path: 'src/components/admin/store-payments-tab.tsx', critical: true,
    description: 'Track ₹500/month per store. Shows all stores with payment status for selected month. Pay Now opens UPI QR modal. Bulk CSV export at GET /api/admin/store-payments/bulk-export?month=YYYY-MM for SBI/HDFC/ICICI bank portals.',
    notes: ['StorePayment model: id, storeId, month (YYYY-MM), amount, status (pending/paid/skipped), utrRef, paidAt', 'Bulk CSV format compatible with SBI YONO Business, HDFC NetBanking, ICICI CIB', 'UPI QR via api.qrserver.com, no new packages'],
    claudePrompt: `Context: Payments tab at src/components/admin/store-payments-tab.tsx. StorePayment model tracks monthly ₹500 payouts. Bulk CSV at src/app/api/admin/store-payments/bulk-export/route.ts.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a 'Reconciliation' view: after admin uploads bank statement CSV (columns: UTR, amount, date, beneficiary), match each row to a StorePayment by UTR or beneficiary name and auto-mark as paid. Show matched/unmatched counts."]

Key files:
- src/components/admin/store-payments-tab.tsx
- src/app/api/admin/payout/route.ts — manual pay trigger
- src/app/api/admin/store-payments/bulk-export/route.ts — CSV generator`,
  },
  {
    id: 'admin-media', cluster: 'Admin Panel', label: 'Site Media Tab', sub: '9 homepage slots + layout preview',
    status: 'built', path: 'src/components/admin/site-media-tab.tsx',
    description: 'Manage 9 named homepage media slots on Cloudflare R2 (hero-consumer, hero-brand, hero-map, etc.). Upload via server-side proxy, grouped by section. Includes visual homepage skeleton preview with green/gray block diagram showing which slots have custom vs default images. Fixed dead india-shop slot → og-cover for OG/social share.',
    notes: ['9 slots: hero-consumer, hero-brand, hero-map, og-cover, how-it-works, flyer-sample, store-partner, brand-partner, cta-bg', 'Section grouping: Hero, Social, Marketing, Partners', 'Skeleton preview shows slot positions with color-coded state (green=custom, gray=default)'],
    claudePrompt: `Context: Site media tab at src/components/admin/site-media-tab.tsx. 9 named R2 slots for homepage images, grouped by section. Upload via POST /api/site-media. Homepage reads slots via mediaUrl() helper.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add image ordering: drag-to-reorder the hero image list. Persist order to a JSON file on R2 at 'site/hero-order.json'. Homepage fetches this file to determine display sequence."]`,
  },
  {
    id: 'admin-design-system', cluster: 'Admin Panel', label: 'Admin Design System', sub: 'Inter Tight + JetBrains Mono + KPI cards',
    status: 'built', path: 'src/app/admin/page.tsx',
    description: 'Full admin UI design system: Inter Tight font for display/headings, JetBrains Mono for badges/labels/tabular numbers. KPI cards (admin-kpi) with SVG sparklines, red gradient feature card. Section labels (N°01 · Label). Live feed with pulsing status dots. Scrolling ticker below topbar. ⌘K global search modal. Red left-border sidebar active state. Admin user chip at sidebar bottom.',
    notes: ['Fonts scoped via src/app/admin/layout.tsx — does not affect marketing site', 'CSS classes prefixed admin- in src/app/globals.css', 'Ticker: 28s scroll animation, JetBrains Mono, 28px tall', 'Search: fetches all stores/campaigns/devices on open, client-side filter, grouped results'],
    claudePrompt: `Context: Admin design system is fully built. CSS utilities in src/app/globals.css (prefixed admin-). Fonts loaded in src/app/admin/layout.tsx.

Key classes:
- admin-font-display (Inter Tight), admin-font-mono (JetBrains Mono)
- admin-kpi, admin-kpi--feature (red gradient KPI card)
- admin-kpi__icon, admin-kpi__label, admin-kpi__value, admin-kpi__sub, admin-kpi__foot, admin-kpi__delta, admin-kpi__delta--up/down
- admin-kpi-row (4-column responsive grid)
- admin-section-label (N°NN · LABEL pattern) — use <SectionLabel n={N} label="..." /> component
- admin-ticker / admin-ticker__track (scrolling info band)
- admin-live-dot, admin-live-dot--online/offline/pending (pulsing status dots)
- admin-feed, admin-feed-item, admin-feed-item__name, admin-feed-item__meta, admin-feed-item__badge
- admin-badge--live/paused/offline/pending (status badges)
- admin-summary-row (4-col grid), admin-summary-tile, admin-summary-tile__label/value/delta
- admin-chips / admin-chip / admin-chip--active (filter chips)
- admin-rings / admin-ring (progress ring grid) — use <ProgressRing pct label sub color /> component

Task: [DESCRIBE YOUR UI CHANGE — e.g. "Add a new admin-kpi card for 'Revenue' showing total paid campaign amount in ₹ with a green delta badge"]`,
  },
  {
    id: 'admin-search', cluster: 'Admin Panel', label: 'Global Search (⌘K)', sub: 'Unified search across stores, campaigns, devices',
    status: 'built', path: 'src/app/admin/page.tsx',
    description: 'Global search modal triggered by ⌘K (or Ctrl+K on Windows) or the topbar search button. Fetches all stores, campaigns, and devices on open, then filters client-side on keystroke. Results grouped by category (max 4 per group). Click any result to navigate to the relevant tab. Closes on Escape.',
    notes: ['Data fetched once on open — no per-keystroke API calls', 'Grouped: Stores / Campaigns / Devices', 'Navigate via click → closes modal → switches tab', 'Keyboard shortcut: metaKey+K (Mac) or ctrlKey+K (Windows/Linux)'],
    claudePrompt: `Context: Global search modal at SearchModal component in src/app/admin/page.tsx. Opens on ⌘K, fetches all data once, client-side filter with grouped results.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add keyboard navigation: arrow keys move through results, Enter opens the selected item. Highlight matched substring in result labels."]`,
  },
  {
    id: 'admin-flyer-generator', cluster: 'Admin Panel', label: 'Satori Flyer Generator', sub: 'Server-side 1080×1920 PNG via next/og',
    status: 'built', path: 'src/app/api/generate-flyer/route.tsx',
    description: 'Edge API route that generates dark-themed 1080×1920 PNG flyers for digital signage using Satori (next/og ImageResponse). Dark background (#0f0f0f), 3×3 product grid on #1e1e1e cards, red circular discount badges, red price pills, hero "WOW" text, QR code footer. POST with FlyerData JSON, returns PNG image.',
    notes: ['Edge runtime — no Node.js APIs, no CSS grid (use flex+wrap)', 'FlyerData: storeName, badge, offerTitle, products[{name,mrp,price,imageUrl,discount}], footerLine1/2, contactLine, qrUrl', 'Products padded to 9 items, CELL_W=346px for 3-column flex wrap in 1080px container', 'Inline styles only — no Tailwind classes in Satori', 'GET /api/generate-flyer returns JSON schema docs'],
    claudePrompt: `Context: Satori flyer generator at src/app/api/generate-flyer/route.tsx. Edge runtime, POST FlyerData JSON → 1080×1920 PNG. Dark theme.

FlyerData interface:
\`\`\`ts
interface FlyerData {
  storeName: string;
  badge: string;           // e.g. "MEGA SALE" or "UP TO 60% OFF"
  offerTitle: string;      // split at '—' into two lines
  validUntil?: string;
  products: Array<{
    name: string; mrp: number; price: number;
    imageUrl?: string; discount?: string;
  }>;
  footerLine1?: string;
  footerLine2?: string;
  contactLine?: string;
  qrUrl?: string;
}
\`\`\`

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a light theme variant triggered by ?theme=light query param. Light: #ffffff bg, #f8f8f8 cards, #dc2626 accents, dark text"]`,
  },
  {
    id: 'admin-apk-sideload', cluster: 'Admin Panel', label: 'APK Sideload Card', sub: 'AFTVnews downloader QR in ScreensTab',
    status: 'built', path: 'src/components/admin/screens-tab.tsx',
    description: 'Collapsible card in ScreensTab for sideloading the ALIVE Player APK onto Fire TV devices via AFTVnews Downloader app. Admin pastes APK URL → card shows QR code (via api.qrserver.com) + step-by-step instructions. Copy-link button for clipboard. Local state only — no API calls.',
    notes: ['No new packages — QR via api.qrserver.com', 'Three steps: install Downloader from Fire TV Store → enter URL or scan QR → install APK', 'Works with any APK URL (Vercel, S3, R2, GitHub Releases)'],
    claudePrompt: `Context: APK sideload card at SideloadApkCard component in src/components/admin/screens-tab.tsx. Collapsible card with URL input, copy button, QR code, and instructions.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a 'Latest APK' section that fetches GET /api/device/update to show the current version number and a pre-filled URL for the latest APK hosted on R2."]`,
  },
  {
    id: 'admin-products', cluster: 'Admin Panel', label: 'Products Tab', sub: 'Master product catalogue with drag-drop images',
    status: 'built', path: 'src/components/admin/products-tab.tsx',
    description: 'Master product catalogue shared across flyer generation. CRUD: create product with name, MRP, sale price, category, brand. Drag-and-drop PNG image upload (no-background images work best) with preview. After creation, image auto-uploaded to R2 via server-side proxy. Products used as input to Satori flyer generator.',
    notes: ['PNG without background recommended for flyer use (products appear on dark cards)', 'Drag-and-drop: onDragOver/onDrop handlers with visual feedback', 'Image upload: POST /api/products/[id]/image after product creation', 'Only new product form has drag-drop — existing product edit uses regular file input'],
    claudePrompt: `Context: Products tab at src/components/admin/products-tab.tsx. Master product catalogue for kirana store items. Drag-drop PNG upload on new product form. Products feed into Satori flyer generator at /api/generate-flyer.

Task: [DESCRIBE YOUR ENHANCEMENT — e.g. "Add a 'Generate flyer from selected products' button: multi-select products via checkboxes, then call POST /api/generate-flyer with the selected products array and open the resulting PNG in a new tab."]

Key files:
- src/components/admin/products-tab.tsx — UI
- src/app/api/generate-flyer/route.tsx — Satori edge route`,
  },
  {
    id: 'admin-moderation', cluster: 'Admin Panel', label: 'Creative Moderation Queue', sub: 'Approve / reject brand creatives',
    status: 't2',
    description: 'Admin review queue for brand-submitted ad creatives before they go live on screens. Approve triggers schedule activation; reject sends email to brand contact.',
    claudePrompt: `Context: Creative moderation is T2/planned. Brand campaigns already save to DB via POST /api/campaigns/save. Content (video/image) stored on R2 via src/components/admin/content-tab.tsx.

Task: Build the creative moderation queue as a new admin tab.

## What to build
1. Add 'moderationStatus' field (pending/approved/rejected) to Content model in prisma/schema.prisma
2. New tab component src/components/admin/moderation-tab.tsx — shows cards of Content items with status=pending
3. Each card shows: thumbnail (signed R2 URL), file name, brand name, upload date, Approve/Reject buttons
4. Approve: PATCH /api/content/[id]/moderate {status: 'approved'} — triggers schedule activation if linked campaign is active
5. Reject: PATCH with {status: 'rejected', reason: string} — fires email to brand via Resend/nodemailer
6. Wire new tab into src/app/admin/page.tsx

## Stack: db.content.findMany({where:{moderationStatus:'pending'}}), no new packages, follow existing admin tab pattern`,
  },
  {
    id: 'admin-roadmap', cluster: 'Admin Panel', label: 'Platform Map', sub: 'Build progress + Claude prompts',
    status: 'built', path: 'src/components/admin/roadmap-tab.tsx',
    description: 'This tab. Visual build-progress map of all ALIVE platform components. Click any item to see description, file path, implementation notes, and a ready-to-paste Claude prompt. 60+ items across 8 clusters: Marketing Site, Store Dashboard, Admin Panel, Device APIs, Background Jobs, Data & Infra, Android Player, Brand Features T2.',
    claudePrompt: `Context: This is the Platform Map tab (src/components/admin/roadmap-tab.tsx). It tracks all 60+ platform items with status, paths, notes, and Claude prompts.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a 'Dependencies' field to each RoadmapItem listing which items must be built first (by ID). Show a dependency warning in the panel if any dependency is not yet 'built'. Block the Claude prompt copy with 'Build X first' message."]`,
  },

  // ── Device APIs ──────────────────────────────────────────────────────────────
  {
    id: 'api-claim', cluster: 'Device APIs', label: 'POST /api/device/claim', sub: 'First-boot → JWT provisioning',
    status: 'built', path: 'src/app/api/device/claim/route.ts', critical: true,
    description: 'Android player posts {hardwareKey, storeName?, storeId?} on first boot. Creates Device record with status PENDING. Returns {deviceId, token} JWT signed with per-device jwtSecret. Subsequent requests use Bearer token.',
    notes: ['hardwareKey = Android Settings.Secure.ANDROID_ID', 'JWT: HS256, payload {deviceId, hardwareKey}, signed with device.jwtSecret', 'Second claim with same hardwareKey returns existing device (idempotent)', 'See ALIVE_PLAYER_API.md for full Kotlin integration guide'],
    claudePrompt: `Context: Device claim endpoint at src/app/api/device/claim/route.ts. Android player POSTs {hardwareKey, storeName, storeId} → gets {deviceId, token}. Device created in DB with status PENDING.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add an OTP verification step: after claim, require admin to approve the device via a 6-digit OTP sent to the store's WhatsApp. Until approved, /api/device/plan returns 401. Add a 'Pending approval' state to the Screens tab."]`,
  },
  {
    id: 'api-events', cluster: 'Device APIs', label: 'POST /api/device/events', sub: 'POP batch + hash chain',
    status: 'built', path: 'src/app/api/device/events/route.ts', critical: true,
    description: 'Receives batched proof-of-play events from Android player. Auth: Bearer JWT. Validates prevHash for tamper-evident chain. Creates PlayEvent rows in bulk. Updates device lastSeen and status to ONLINE.',
    notes: ['Body: {events: [{mediaId, layoutId, campaignId, startedAt, endedAt, durationMs, tag, impressions, costPaise, prevHash}]}', 'rowHash = SHA-256(deviceId+mediaId+startedAt+durationMs+prevHash)', 'Device status set to ONLINE on successful event post', 'See ALIVE_PLAYER_API.md section 2 for full spec'],
    claudePrompt: `Context: Events endpoint at src/app/api/device/events/route.ts. Receives batched POP events from Android player with JWT auth. Creates PlayEvent rows in bulk with hash chain.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add real-time webhook: after saving events, if any event has costPaise > 0 and is linked to a Campaign with walletPaise balance, debit the wallet atomically using db.$transaction. If wallet runs low (< 1 day of spend), call notifyAdminWA() to alert."]`,
  },
  {
    id: 'api-plan', cluster: 'Device APIs', label: 'GET /api/device/plan', sub: '72-hour schedule + content window',
    status: 'built', path: 'src/app/api/device/plan/route.ts', critical: true,
    description: 'Returns next 72h of scheduled content for the authenticated device. Resolves device schedules by deviceId OR groupName (group wins on overlap by priority). Returns flat list of {mediaUrl, md5, startAt, endAt, durationMs, layoutId, tag}.',
    notes: ['Auth: Bearer JWT from claim step', 'Content URLs are R2 signed URLs valid 73 hours', 'MD5 included so player can skip re-download if local file matches', 'Updates device lastSeen on every plan fetch'],
    claudePrompt: `Context: Plan endpoint at src/app/api/device/plan/route.ts. Returns 72h schedule window with R2 content URLs and MD5s. Auth via Bearer JWT. Player caches this for offline operation.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add delta sync: accept ?since=ISO_TIMESTAMP query param. If provided, only return schedule items that changed after that timestamp. Return {items: [...], serverTime: ISO} so player can use serverTime as next since param, reducing payload size on frequent polls."]`,
  },
  {
    id: 'api-devices', cluster: 'Device APIs', label: 'GET /api/devices', sub: 'Fleet list with live schedule',
    status: 'built', path: 'src/app/api/devices/route.ts',
    description: 'Admin fleet list. Returns all devices with currentSchedule (active schedule name + end time), lastPlayAt, uptimePct, status. Auth: admin-password header.',
    claudePrompt: `Context: Devices fleet endpoint at src/app/api/devices/route.ts. Returns devices with currentSchedule + lastPlayAt computed via playEvent.groupBy.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add PATCH /api/devices/[id] for admin to update device groupName and storeName inline from the Screens tab. Also add DELETE /api/devices/[id] with a confirmation step."]`,
  },
  {
    id: 'api-payout', cluster: 'Device APIs', label: 'POST /api/admin/payout', sub: 'Razorpay X + UPI fallback',
    status: 'built', path: 'src/app/api/admin/payout/route.ts',
    description: 'Initiate store partner payout. If RAZORPAY_X env vars set, uses Razorpay X transfer API. Otherwise falls back to UPI deep-link reference. Creates/updates StorePayment record.',
    claudePrompt: `Context: Payout endpoint at src/app/api/admin/payout/route.ts. POST with {storeId, month, utrRef?, method} creates StorePayment row. Razorpay X payout only works if RAZORPAY_X_KEY_ID, RAZORPAY_X_KEY_SECRET, RAZORPAY_X_ACCOUNT_NUMBER are set in Vercel env vars.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add webhook handler for Razorpay X payout events at POST /api/admin/payout/webhook. On payout.processed event, mark StorePayment as paid and send WhatsApp confirmation to the store partner via notifyAdminWA()."]`,
  },
  {
    id: 'api-health', cluster: 'Device APIs', label: 'GET /api/health', sub: 'Platform health check',
    status: 'built', path: 'src/app/api/health/route.ts',
    description: 'Returns platform health: DB connectivity, Redis ping, R2 reachability. Returns {status: "ok"|"degraded", checks: {...}}.',
    claudePrompt: `Context: Health check at src/app/api/health/route.ts. Returns DB/Redis/R2 status.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add device fleet health to the check: return {devicesTotal, devicesOnline, devicesOffline24h} counts from the Device table alongside the existing infra checks."]`,
  },

  // ── Background Jobs ──────────────────────────────────────────────────────────
  {
    id: 'job-health-cron', cluster: 'Background Jobs', label: 'Device Health Cron', sub: 'Offline detect → tickets',
    status: 'built', path: 'src/app/api/cron/device-health/route.ts',
    description: 'Runs every 5 min via Vercel cron. Marks devices OFFLINE if lastSeen > 20 min. Creates RemediationTicket and fires notifyAdminWA + /api/agent/remediate — both are fully wired.',
    notes: [
      'Field-trial audit (pre-ELEVATE-T1) found vercel.json had no `crons` array at all — this route had never actually been invoked by Vercel in production, despite being fully implemented. Fixed: registered at */5 * * * *.',
      'Same audit raised the offline threshold from 10 to 20 min (here, plus /api/devices and /api/devices/groups) — the player heartbeat is a WorkManager PeriodicWorkRequest, which Android clamps to a real 15-min floor regardless of the interval requested, so 10 min was flapping healthy devices OFFLINE.',
      'Cron secret auth: CRON_SECRET env var',
      'WhatsApp alert: notifyAdminWA() fires on ticket creation',
      'Auto-remediate: fire-and-forget POST to /api/agent/remediate with ticketId',
    ],
  },
  {
    id: 'job-context-sync', cluster: 'Background Jobs', label: 'Context Sync Cron', sub: 'Platform state for AI',
    status: 'built', path: 'src/app/api/cron/context-sync/route.ts',
    description: 'Syncs platform context snapshot (store list, device states, active campaigns) into a cache for AI query features. Run daily.',
    claudePrompt: `Context: Context sync cron at src/app/api/cron/context-sync/route.ts. Builds a platform snapshot for AI features (query router, context engine).

Task: [DESCRIBE YOUR CHANGE — e.g. "Add store growth metrics to the context snapshot: new stores this week, stores that went live vs agreed, average time to go-live. Include in the context JSON that gets cached."]`,
  },
  {
    id: 'job-signals', cluster: 'Background Jobs', label: 'External Signals Cron', sub: 'Festival / weather / news',
    status: 'built', path: 'src/app/api/cron/external-signals/route.ts',
    description: 'Pulls festival calendar (hardcoded Indian festivals), local weather (OpenWeatherMap or similar), and news for contextual ad targeting suggestions.',
    claudePrompt: `Context: External signals cron at src/app/api/cron/external-signals/route.ts. Pulls 3 signal sources for AI context.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a local kirana market pricing index: scrape IndiaMART or AgriMarket for wholesale prices of top 20 FMCG items. Store as JSON in Redis key 'signals:market-prices'. Include in AI context for price-driven ad copy suggestions."]`,
  },
  {
    id: 'job-whatsapp', cluster: 'Background Jobs', label: 'WhatsApp Alerts', sub: 'Device offline → notify admin',
    status: 'built', path: 'src/lib/notify.ts',
    description: 'notifyAdminWA() wired in health cron after ticket creation. Sends WhatsApp via Twilio to ADMIN_WHATSAPP env var. No-op gracefully if TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set. Add env vars in Vercel to activate.',
    notes: ['Env vars needed in Vercel: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ADMIN_WHATSAPP', 'Code is fully wired — adding env vars is all that\'s needed to go live', 'Also has notifyAdminEmail() via Resend if RESEND_API_KEY set'],
    claudePrompt: `Context: notifyAdminWA() exists at src/lib/notify.ts but is not being called. The device health cron at src/app/api/cron/device-health/route.ts creates RemediationTickets but doesn't trigger alerts.

Task: Wire WhatsApp alerts into the health cron AND add a test endpoint.

## Changes needed:
1. src/app/api/cron/device-health/route.ts — after ticket creation, call notifyAdminWA() (see device-health cron prompt for exact code)
2. src/app/api/admin/test-alert/route.ts (NEW) — POST endpoint that calls notifyAdminWA("Test alert from ALIVE admin") to verify the integration works. Auth: admin-password header.
3. Add a "Send test alert" button to the monitoring tab (src/components/admin/monitoring-tab.tsx) that calls the test endpoint.

Check src/lib/notify.ts to see what env vars are needed and whether the WhatsApp provider (Twilio/Meta) is configured.`,
  },
  {
    id: 'job-remediation', cluster: 'Background Jobs', label: 'Auto Remediation', sub: 'AI proposes fixes for issues',
    status: 'built',
    description: 'POST /api/agent/remediate wired and auto-triggered from health cron after ticket creation (fire-and-forget fetch). Proposals stored in RemediationProposal model. Monitoring tab shows open tickets.',
    claudePrompt: `Context: /api/agent/remediate exists and generates AI fix proposals for device issues. The health cron (src/app/api/cron/device-health/route.ts) creates RemediationTickets but doesn't call this endpoint.

Task: Complete the auto-remediation pipeline.

## Changes needed:
1. Wire health cron → auto-call /api/agent/remediate per ticket (see device-health cron prompt)
2. src/components/admin/monitoring-tab.tsx — add "Remediation" panel: show open tickets with their AI proposals
3. Each proposal should have an "Acknowledge" button (PATCH /api/agent/remediate/[id]/ack) to mark admin read it
4. Add RemediationProposal fetch to the monitoring tab: GET /api/agent/remediation-tickets (create this endpoint) returns tickets with nested proposals

## DB models to check: RemediationTicket, RemediationProposal in prisma/schema.prisma`,
  },
  {
    id: 'job-gst', cluster: 'Background Jobs', label: 'GST Invoice Generator', sub: 'Automated GST invoices',
    status: 't2',
    description: 'Automated GST invoice generation for brand campaigns. Needs CA validation before enabling. VS Collective LLP GSTIN: 29AAXFV2589C1ZE.',
    claudePrompt: `Context: GST invoicing is T2 (future). Brand campaigns already capture gstin, totalAmount, gstAmount in the Campaign model. VS Collective LLP GSTIN is 29AAXFV2589C1ZE.

Task: Build automated GST invoice generation.

## What to build:
1. src/app/api/admin/invoices/route.ts — POST {campaignId} generates a GST invoice PDF
   - Use pdfkit or html-to-pdf approach
   - Invoice fields: invoice number (INV-YYYY-NNNN), date, Party A (VS Collective LLP with GSTIN), Party B (brand name + GSTIN), line items (advertising service), subtotal, CGST 9%, SGST 9%, total
   - Save PDF to R2 at 'invoices/INV-YYYY-NNNN.pdf'
   - Store invoice metadata in DB (new Invoice model)
2. src/components/admin/campaigns-tab — add "Generate Invoice" button per campaign

## Constraints:
- HSN code for digital advertising: 998366
- Get CA validation before going live — add a feature flag env var ENABLE_GST_INVOICES
- Invoice numbering must be sequential per financial year`,
  },

  // ── Data & Infra ─────────────────────────────────────────────────────────────
  {
    id: 'infra-postgres', cluster: 'Data & Infra', label: 'PostgreSQL / Neon', sub: 'Primary database',
    status: 'built', critical: true,
    description: 'Neon serverless Postgres. Pooled DATABASE_URL for Vercel runtime, direct DATABASE_DIRECT_URL for migrations. Prisma 6 ORM. 15+ models covering all platform entities.',
    notes: ['Two connection strings required: DATABASE_URL (pooled, .c-7 in host) + DATABASE_DIRECT_URL (direct)', 'Run migrations: npx prisma migrate dev --name description (dev) or npx prisma migrate deploy (prod)', 'Prisma studio: npx prisma studio (opens browser UI on localhost:5555)'],
    claudePrompt: `Context: Neon PostgreSQL + Prisma 6. Schema at prisma/schema.prisma. Migration history in prisma/migrations/.

Task: [DESCRIBE YOUR SCHEMA CHANGE — e.g. "Add a 'StoreMetric' model that stores weekly aggregate stats per store: weekStart Date, impressionsDelivered Int, screenUptimePct Float, revenueEarned Int. Add index on storeId+weekStart. Create migration."]

After schema changes:
1. Run: npx prisma migrate dev --name your_migration_name
2. Run: npx prisma generate
3. Update src/lib/backend-api.ts if new types are needed client-side`,
  },
  {
    id: 'infra-redis', cluster: 'Data & Infra', label: 'Redis / Upstash', sub: 'Cache + rate limiting',
    status: 'built',
    description: 'Upstash Redis for sessions, rate limiting, short-lived state. Always use lazy getRedis() pattern (never module-level instantiation to avoid SSG breakage).',
    notes: ['Pattern: function getRedis() { if (!process.env.UPSTASH_REDIS_REST_URL) return null; return new Redis({...}) }', 'Keys: stores:index, store:{id}, flyers:index, flyer:{id}, campaigns:all (legacy, migrating to Postgres)'],
    claudePrompt: `Context: Upstash Redis used for legacy flyer storage and sessions. Pattern: lazy getRedis() in every file that uses it.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add rate limiting to POST /api/stores/login: max 5 attempts per phone per 15 minutes using Redis INCR + EXPIRE. Return 429 with 'Too many attempts, try again in X minutes' after limit exceeded."]

Pattern to follow:
\`\`\`ts
function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
}
\`\`\``,
  },
  {
    id: 'infra-r2', cluster: 'Data & Infra', label: 'Cloudflare R2', sub: 'Zero-egress media storage',
    status: 'built', critical: true,
    description: 'R2 bucket alive-media for all media. Content uploaded server-side via /api/admin/r2-upload (AWS SDK putObject). Public URL via R2_PUBLIC_BASE env var. Zero egress cost.',
    notes: ['R2 helpers in src/lib/r2.ts: getSignedUploadUrl(), deleteObject()', 'Server-side upload proxy at src/app/api/admin/r2-upload/route.ts avoids CORS issues', 'Content public URL: process.env.R2_PUBLIC_BASE + "/" + objectKey'],
    claudePrompt: `Context: Cloudflare R2 at src/lib/r2.ts. Upload flow: POST /api/admin/r2-upload (server-side AWS SDK putObject) then store objectKey in DB. Public access via R2_PUBLIC_BASE env var.

Task: [DESCRIBE YOUR CHANGE — e.g. "Add a bulk delete endpoint: POST /api/admin/r2-bulk-delete {objectKeys: string[]} that calls R2 deleteObjects for up to 1000 keys at once. Wire to a 'Select all + Delete' action in the content tab."]`,
  },
  {
    id: 'infra-prisma', cluster: 'Data & Infra', label: 'Prisma Migrations', sub: 'Schema + migration history',
    status: 'built', path: 'prisma/schema.prisma',
    description: 'Prisma 6 schema with all models: User, Store, Brand, Campaign, Device, Content, Playlist, PlaylistItem, Schedule, PlayEvent, Flyer, AuditLog, StorePayment, RemediationTicket, RemediationProposal, Bill, BillItem, Customer.',
    claudePrompt: `Context: Full Prisma 6 schema at prisma/schema.prisma. All models are defined. Production DB on Neon PostgreSQL. package.json build script runs \`prisma generate && prisma migrate deploy\` before \`next build\`.

Task: [DESCRIBE YOUR SCHEMA CHANGE]

After any schema change:
1. npx prisma migrate dev --name your_change_name
2. npx prisma generate
3. Commit both prisma/schema.prisma AND the new migration file in prisma/migrations/`,
  },
  {
    id: 'infra-vercel', cluster: 'Data & Infra', label: 'Vercel Deploy', sub: 'Auto-deploy on push to main',
    status: 'built',
    description: 'Push to main → auto-deploy to Vercel production at wearealive.in. Feature branch: claude/build-alive-advertising-platform-tlG96. prisma migrate deploy runs in build script.',
    notes: ['Required env vars in Vercel: DATABASE_URL, DATABASE_DIRECT_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE, AUTH_SECRET, ADMIN_PASSWORD, NEXT_PUBLIC_RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET'],
    claudePrompt: `Context: Vercel deployment at wearealive.in. Auto-deploys from main branch. Feature work happens on branch claude/build-alive-advertising-platform-tlG96.

Task: [DESCRIBE YOUR INFRA CHANGE — e.g. "Add a /api/cron/monthly-payouts endpoint (new Vercel cron) that runs on the 1st of each month to create StorePayment records for all live stores. Configure in vercel.json crons array."]

For new cron jobs, add to vercel.json:
\`\`\`json
{
  "crons": [
    {"path": "/api/cron/monthly-payouts", "schedule": "0 0 1 * *"}
  ]
}
\`\`\`
Cron endpoint must check CRON_SECRET header for auth.`,
  },
  {
    id: 'infra-internal-api-auth', cluster: 'Data & Infra', label: 'Internal API Auth Sweep', sub: 'Every data-bearing route now requires admin-password',
    status: 'built', critical: true,
    description: 'Field-trial audit found /api/query (campaign emails, payment IDs, bill totals, store payout status, external-signal aggregates via a DSL) and /api/context/search (semantic search over internal ContextDocument rows) had no authentication at all — the only two data-bearing routes in the whole API surface missing the admin-password guard every other admin route already has. Both fixed.',
  },

  // ── Android Player ───────────────────────────────────────────────────────────
  {
    id: 'player-launcher', cluster: 'Android Player', label: 'SystemLauncher', sub: 'Home app, survives reboot',
    status: 'planned', critical: true,
    description: 'Android TV launcher activity that sets ALIVE Player as the home app. Device boots directly into the player. Survives app crashes and power cycles.',
    notes: ['Requires CATEGORY_HOME + CATEGORY_DEFAULT intent filter in AndroidManifest.xml', 'Android TV: also add LEANBACK_LAUNCHER intent', 'Boot persistence: add android.intent.action.BOOT_COMPLETED receiver'],
    claudePrompt: `Context: ALIVE Android Player is a Kotlin Android TV APK. ALIVE_PLAYER_API.md in the repo root has the full backend API spec (claim, events, plan endpoints). The player needs to survive reboots and act as the home app on Android TV devices installed at kirana stores.

Task: Build the SystemLauncher module.

## AndroidManifest.xml changes:
\`\`\`xml
<activity android:name=".PlayerActivity" android:launchMode="singleTask">
  <intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.HOME" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
  </intent-filter>
</activity>

<receiver android:name=".BootReceiver" android:exported="true">
  <intent-filter>
    <action android:name="android.intent.action.BOOT_COMPLETED" />
  </intent-filter>
</receiver>
\`\`\`

## BootReceiver.kt:
\`\`\`kotlin
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
      val launch = Intent(context, PlayerActivity::class.java)
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(launch)
    }
  }
}
\`\`\`

## Required manifest permissions:
- android.permission.RECEIVE_BOOT_COMPLETED
- android.permission.INTERNET
- android.permission.ACCESS_NETWORK_STATE`,
  },
  {
    id: 'player-watchdog', cluster: 'Android Player', label: 'WatchdogService', sub: 'Crash detect + auto restart',
    status: 'built', critical: true,
    description: 'WatchdogService now exists, running in its own OS process (android:process=":watchdog") rather than same-process as originally speculated — that distinction matters: it stays responsive even if the main process fully freezes. Checks a heartbeat-timestamp file every 20s; if stale 90s+, kills the main process (safe — sibling processes of the same app share one Linux UID) and restarts it via startForegroundService.',
    notes: [
      'Superseded the original same-process foreground-service + AlarmManager design below in favor of a genuinely separate process — see player-watchdog-xproc for the mechanism.',
      'BootReceiver and PlaybackForegroundService.onCreate() both call WatchdogService.ensureRunning() — either one coming up brings the other with it.',
      'Requires foregroundServiceType="specialUse" on API 34+ (targetSdk 35 rejects an untyped foreground service at runtime) — verified via lintVitalRelease.',
    ],
  },
  {
    id: 'player-ntp', cluster: 'Android Player', label: 'NTPSyncManager', sub: 'Clock accuracy for POP timestamps',
    status: 'in-progress', critical: true,
    description: 'NTP client that syncs the device clock offset for accurate proof-of-play timestamps. Critical for billing accuracy. RICE score: 405 — build before POPEmitter.',
    notes: ['NTP server: pool.ntp.org or time.google.com', 'Compute clockOffset = ntpTime - systemTime, store in SharedPreferences', 'Apply offset to all POP timestamps: correctedTime = System.currentTimeMillis() + clockOffset', 'Re-sync every 24h or on network reconnect'],
    claudePrompt: `Context: POP timestamps must be accurate for billing. NTPSyncManager syncs clock offset and all proof-of-play timestamps must be corrected by this offset. ALIVE backend at POST /api/device/events accepts ISO timestamp strings.

Task: Build NTPSyncManager.kt

\`\`\`kotlin
object NTPSyncManager {
  private const val NTP_HOST = "pool.ntp.org"
  private const val PREFS_KEY = "ntp_clock_offset"
  private var clockOffsetMs: Long = 0L

  fun sync(context: Context) {
    try {
      val client = NTPUDPClient()
      client.defaultTimeout = 5000
      client.open()
      val info = client.getTime(InetAddress.getByName(NTP_HOST))
      clockOffsetMs = info.offset
      context.getSharedPreferences("alive_player", MODE_PRIVATE)
        .edit().putLong(PREFS_KEY, clockOffsetMs).apply()
      client.close()
    } catch (e: Exception) { /* use cached offset */ }
  }

  fun restore(context: Context) {
    clockOffsetMs = context.getSharedPreferences("alive_player", MODE_PRIVATE)
      .getLong(PREFS_KEY, 0L)
  }

  fun now(): Long = System.currentTimeMillis() + clockOffsetMs
  fun nowIso(): String = Instant.ofEpochMilli(now()).toString()
}
\`\`\`

Add dependency: org.apache.commons:commons-net:3.9.0 in build.gradle.
Call NTPSyncManager.sync(context) in SyncManager after each successful plan fetch.
Use NTPSyncManager.nowIso() for all startedAt/endedAt timestamps in POPEmitter.`,
  },
  {
    id: 'player-cache', cluster: 'Android Player', label: 'ContentCache', sub: 'Local creative store + MD5 verify',
    status: 'built',
    description: 'Downloads and caches ad creatives (video/image) locally. MD5 verification before serving to avoid corrupt file playback. Cache lives in app-specific external storage.',
    notes: ['Cache dir: context.getExternalFilesDir("creatives")', 'Download with OkHttp, verify MD5 before marking ready', 'Eviction: LRU by last-accessed time, keep max 2GB'],
    claudePrompt: `Context: Android player receives content URLs and MD5s from GET /api/device/plan. ContentCache downloads files locally and serves from cache. MD5 check skips re-download if file matches.

Task: Build ContentCache.kt

\`\`\`kotlin
object ContentCache {
  private lateinit var cacheDir: File

  fun init(context: Context) {
    cacheDir = File(context.getExternalFilesDir(null), "creatives").apply { mkdirs() }
  }

  fun getOrDownload(url: String, md5: String, callback: (File?) -> Unit) {
    val cacheFile = File(cacheDir, md5 + extension(url))
    if (cacheFile.exists() && verifyMd5(cacheFile, md5)) {
      callback(cacheFile); return
    }
    OkHttpClient().newCall(Request.Builder().url(url).build()).enqueue(object : Callback {
      override fun onResponse(call: Call, response: Response) {
        response.body?.let { body ->
          cacheFile.outputStream().use { body.byteStream().copyTo(it) }
          if (verifyMd5(cacheFile, md5)) callback(cacheFile)
          else { cacheFile.delete(); callback(null) }
        }
      }
      override fun onFailure(call: Call, e: IOException) = callback(null)
    })
  }

  private fun verifyMd5(file: File, expected: String): Boolean {
    val md = MessageDigest.getInstance("MD5")
    return file.inputStream().use { md.digest(it.readBytes()) }
      .joinToString("") { "%02x".format(it) } == expected
  }
}
\`\`\``,
  },
  {
    id: 'player-sync', cluster: 'Android Player', label: 'SyncManager', sub: 'Delta schedule + content pull',
    status: 'in-progress', critical: true,
    description: 'Polls GET /api/device/plan?hours=72 every 15 minutes. Compares new plan with cached plan, downloads only new/changed content. Stores schedule in local SQLite for offline operation.',
    notes: ['Poll interval: 15 min normally, 5 min if plan is empty or device just came online', 'Store JWT in SharedPreferences key alive_device_token', 'Schedule stored as JSON in SQLite table device_plan (one row, upsert)'],
    claudePrompt: `Context: SyncManager polls GET /api/device/plan from wearealive.in/api/device/plan. Auth: Bearer token from SharedPreferences. Plan response: {items: [{mediaUrl, md5, startAt, endAt, durationMs, layoutId, tag}]}. See ALIVE_PLAYER_API.md for full spec.

Task: Build SyncManager.kt

\`\`\`kotlin
class SyncManager(private val context: Context) {
  private val BASE_URL = "https://wearealive.in"
  private val client = OkHttpClient()

  fun sync() {
    val token = getToken() ?: return
    val req = Request.Builder()
      .url("$BASE_URL/api/device/plan?hours=72")
      .header("Authorization", "Bearer $token")
      .build()
    client.newCall(req).execute().use { resp ->
      if (!resp.isSuccessful) return
      val plan = Gson().fromJson(resp.body!!.charStream(), PlanResponse::class.java)
      savePlan(plan)
      // pre-download all content
      plan.items.forEach { item ->
        ContentCache.getOrDownload(item.mediaUrl, item.md5) {}
      }
      NTPSyncManager.sync(context) // re-sync clock after network activity
    }
  }

  data class PlanResponse(val items: List<PlanItem>)
  data class PlanItem(val mediaUrl: String, val md5: String, val startAt: String,
    val endAt: String, val durationMs: Long, val layoutId: String?, val tag: String?)
}
\`\`\`

Schedule sync via WorkManager with PeriodicWorkRequest (15 min interval, NETWORK_CONNECTED constraint).`,
  },
  {
    id: 'player-playback', cluster: 'Android Player', label: 'PlaybackEngine', sub: 'ExoPlayer video + image renderer',
    status: 'in-progress', critical: true,
    description: 'ExoPlayer-based video player and image renderer. Reads local schedule from SQLite. Transitions between media items based on durationMs. Notifies POPEmitter after each play.',
    notes: ['ExoPlayer 2.x or Media3: implementation "androidx.media3:media3-exoplayer:1.3.0"', 'Image rendering: Glide fullscreen with center-crop, duration from schedule item', 'Preload next item during current item playback for gapless transition'],
    claudePrompt: `Context: PlaybackEngine is the core of the ALIVE Player. It reads the locally-cached schedule (from SyncManager), plays content in order using ExoPlayer for video and Glide for images, and fires POPEmitter after each play.

Task: Build PlaybackEngine.kt

\`\`\`kotlin
class PlaybackEngine(private val context: Context, private val container: ViewGroup) {
  private var player: ExoPlayer? = null
  private var onPlayComplete: ((PlanItem) -> Unit)? = null

  fun setOnPlayComplete(cb: (PlanItem) -> Unit) { onPlayComplete = cb }

  fun play(item: PlanItem) {
    val file = ContentCache.getCachedFile(item.md5) ?: return // skip if not cached
    when {
      item.mediaUrl.endsWith(".mp4", true) -> playVideo(file, item)
      else -> showImage(file, item)
    }
  }

  private fun playVideo(file: File, item: PlanItem) {
    player = ExoPlayer.Builder(context).build().also { exo ->
      val playerView = PlayerView(context).apply { player = exo; useController = false }
      container.addView(playerView, matchParent())
      val source = ProgressiveMediaSource.Factory(DefaultDataSource.Factory(context))
        .createMediaSource(MediaItem.fromUri(file.toUri()))
      exo.setMediaSource(source)
      exo.prepare(); exo.play()
      exo.addListener(object : Player.Listener {
        override fun onPlaybackStateChanged(s: Int) {
          if (s == Player.STATE_ENDED) { cleanup(); onPlayComplete?.invoke(item) }
        }
      })
    }
  }
  // ... showImage with Handler delay using item.durationMs
}
\`\`\`

Dependencies in build.gradle:
- androidx.media3:media3-exoplayer:1.3.0
- com.github.bumptech.glide:glide:4.16.0`,
  },
  {
    id: 'player-pop', cluster: 'Android Player', label: 'POPEmitter', sub: 'Per-play log + offline SQLite buffer',
    status: 'in-progress', critical: true,
    description: 'Records each play event as a PlayEvent row in local SQLite. Batches and POSTs to POST /api/device/events when online. Uses NTPSyncManager.nowIso() for accurate timestamps. Hash-chains events for tamper evidence.',
    notes: ['SQLite table: pop_events (id, mediaId, layoutId, campaignId, startedAt, endedAt, durationMs, tag, prevHash, rowHash, synced BOOL)', 'Batch size: 50 events per POST to /api/device/events', 'Retry failed batches with exponential backoff'],
    claudePrompt: `Context: POPEmitter records proof-of-play events and POSTs them to wearealive.in/api/device/events. Auth: Bearer token. Events buffered in local SQLite when offline. See ALIVE_PLAYER_API.md section 2 for exact API contract.

Task: Build POPEmitter.kt

\`\`\`kotlin
class POPEmitter(private val context: Context) {
  private val db = POPDatabase.getInstance(context)
  private val client = OkHttpClient()
  private val BASE_URL = "https://wearealive.in"

  fun record(item: PlanItem, startedAt: String, endedAt: String) {
    val durationMs = ChronoUnit.MILLIS.between(
      Instant.parse(startedAt), Instant.parse(endedAt))
    val prevHash = db.popDao().getLastHash() ?: "0".repeat(64)
    val rowHash = sha256("$deviceId$\{item.mediaId}$startedAt$durationMs$prevHash")
    db.popDao().insert(PopEvent(
      mediaId = item.mediaId, layoutId = item.layoutId, campaignId = item.tag,
      startedAt = startedAt, endedAt = endedAt, durationMs = durationMs,
      tag = item.tag, prevHash = prevHash, rowHash = rowHash, synced = false
    ))
  }

  fun flush() {
    val unsynced = db.popDao().getUnsynced(limit = 50)
    if (unsynced.isEmpty()) return
    val token = getToken() ?: return
    val body = mapOf("events" to unsynced.map { it.toApiMap() })
    val req = Request.Builder().url("$BASE_URL/api/device/events")
      .header("Authorization", "Bearer $token")
      .post(Gson().toJson(body).toRequestBody("application/json".toMediaType()))
      .build()
    client.newCall(req).execute().use { resp ->
      if (resp.isSuccessful) db.popDao().markSynced(unsynced.map { it.id })
    }
  }
}
\`\`\`

Call flush() from SyncManager after every successful plan fetch, and on network-reconnect events.`,
  },
  {
    id: 'player-telemetry', cluster: 'Android Player', label: 'TelemetryAgent', sub: 'CPU/RAM/net heartbeat',
    status: 'planned',
    description: 'Sends periodic device telemetry to /api/device/heartbeat: CPU usage, RAM free, network type (WiFi/4G), app uptime. Used by admin monitoring tab.',
    claudePrompt: `Context: Admin monitoring tab fetches device health from GET /api/devices. Currently shows lastSeen and status. TelemetryAgent would add CPU/RAM/network data.

Task: Build TelemetryAgent.kt AND add/extend the heartbeat endpoint.

## Android side:
\`\`\`kotlin
class TelemetryAgent(private val context: Context) {
  fun sendHeartbeat() {
    val runtime = Runtime.getRuntime()
    val payload = mapOf(
      "cpuPct" to getCpuUsage(),
      "ramFreeMb" to (runtime.freeMemory() / 1024 / 1024),
      "netType" to getNetworkType(context),
      "uptimeMs" to SystemClock.elapsedRealtime()
    )
    val token = getToken() ?: return
    OkHttpClient().newCall(Request.Builder()
      .url("https://wearealive.in/api/device/heartbeat")
      .header("Authorization", "Bearer $token")
      .post(Gson().toJson(payload).toRequestBody("application/json".toMediaType()))
      .build()
    ).execute()
  }
}
\`\`\`

## Backend side:
Create src/app/api/device/heartbeat/route.ts — POST, Bearer JWT auth, updates Device row with {cpuPct, ramFreeMb, netType, uptimeMs, lastSeen: new Date()}.
Add these columns to Device model in prisma/schema.prisma: cpuPct Float?, ramFreeMb Int?, netType String?, uptimeMs BigInt?

Call sendHeartbeat() every 5 minutes from SyncManager.`,
  },
  {
    id: 'player-apk', cluster: 'Android Player', label: 'APK Distribution', sub: 'Signed APK + OTA update channel',
    status: 'planned',
    description: 'Signed Android APK distributed to store partners. OTA update channel so all deployed devices can be updated remotely. ALIVE_PLAYER_API.md in repo root has full integration guide.',
    notes: ['ALIVE_PLAYER_API.md in repo root is the canonical Android developer integration guide', 'OTA: POST /api/device/update endpoint returns {latestVersion, apkUrl} — player compares with BuildConfig.VERSION_CODE', 'Signing: Android keystore, release build variant'],
    claudePrompt: `Context: ALIVE_PLAYER_API.md in the repo root has the full backend API contract for Android player developers. The APK needs to be signed for distribution and have an OTA update mechanism.

Task: Build the OTA update system.

## Backend: src/app/api/device/update/route.ts
\`\`\`ts
// GET /api/device/update — Bearer JWT auth
// Returns {latestVersion: number, apkUrl: string, releaseNotes: string, mandatory: boolean}
// Store latest APK on R2 at 'apk/alive-player-vX.X.X.apk'
// Store version metadata in env var PLAYER_LATEST_VERSION or a DB record
\`\`\`

## Android: UpdateChecker.kt
\`\`\`kotlin
class UpdateChecker(private val context: Context) {
  fun checkAndUpdate() {
    val resp = // GET /api/device/update with Bearer token
    val remoteVersion = resp.latestVersion
    if (remoteVersion > BuildConfig.VERSION_CODE) {
      downloadAndInstall(resp.apkUrl, resp.mandatory)
    }
  }

  private fun downloadAndInstall(apkUrl: String, mandatory: Boolean) {
    // Download APK to cache, then:
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(FileProvider.getUriForFile(context, "$packageName.provider", apkFile),
        "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
  }
}
\`\`\`

Check for updates in SyncManager.sync() once every 24 hours.`,
  },

  // ── Android Player — Resilience ──────────────────────────────────────────────
  {
    id: 'player-exoplayer-guard', cluster: 'Android Player', label: 'ExoPlayer Resilience', sub: 'Double-release guard + Glide bitmap leak fix',
    status: 'built', critical: true,
    description: 'Prevents ExoPlayer double-release race condition (captured null before mainHandler.post) and Glide bitmap accumulation (Glide.clear before each image swap in both renderItem and restartCurrentItem). Critical for 24/7 unattended devices.',
    notes: ['PlaybackEngine.kt: capture exoPlayer → null before posting release to avoid second call racing', 'Glide.with(context).clear(iv) called before every .into(iv) to release previous bitmap', 'restartCurrentItem() also patched — same bug was duplicated there'],
  },
  {
    id: 'player-asset-integrity', cluster: 'Android Player', label: 'Asset Download Hardening', sub: 'Free-space check + tmp cleanup + renameTo fallback',
    status: 'built', critical: true,
    description: 'AssetDownloader now checks StatFs free bytes against Content-Length before writing (refuses download if < content + 50 MB buffer). Cleans up corrupt .tmp on exception. Falls back to copy+delete if renameTo fails cross-filesystem.',
    notes: ['StatFs check after connection, before stream copy', 'catch(ex) { tmp.delete(); throw ex } wraps stream copy', 'tmp.renameTo(final) fallback: tmp.copyTo(final, overwrite=true) + tmp.delete()'],
  },
  {
    id: 'player-ntp-impl', cluster: 'Android Player', label: 'NTP Clock Sync', sub: 'Raw UDP SNTP client, offset stored in DevicePrefs',
    status: 'built', critical: true,
    description: 'NtpSyncManager.kt uses raw UDP datagrams to query pool.ntp.org (no external library). Clock offset stored in DevicePrefs and applied to all POP timestamps. PlanFetchWorker calls sync() after every successful plan fetch. PlaybackEngine uses NtpSyncManager.now() for playStartMs and stop() times.',
    notes: ['48-byte NTP packet, transmit timestamp at bytes 40-47', 'clockOffset = ntpTime − requestTime − (RTT/2)', 'DevicePrefs.getClockOffsetMs() defaults to 0 until first sync — no invalid offset on first boot', 'PopUploadWorker applies offset to startedAt/endedAt before upload'],
  },
  {
    id: 'player-captive-portal', cluster: 'Android Player', label: 'Captive Portal Detection', sub: 'NET_CAPABILITY_VALIDATED guard on all workers',
    status: 'built',
    description: 'PlanFetchWorker and DownloadWorker check NetworkCapabilities.NET_CAPABILITY_VALIDATED before making network requests. Captive portals pass the CONNECTED constraint but can\'t reach the backend — this prevents silent failures that look like server errors.',
    notes: ['isValidatedNetwork(): ConnectivityManager → activeNetwork → getNetworkCapabilities → hasCapability(VALIDATED)', 'Worker returns Result.retry() on captive portal, not Result.failure() — will auto-retry when portal is dismissed'],
  },
  {
    id: 'player-pop-poison', cluster: 'Android Player', label: 'POP Poison Isolation', sub: 'failCount column + batch limit 50',
    status: 'built', critical: true,
    description: 'ProofEvent entity now has failCount column. getPending() excludes events with failCount >= 3 (poison rows that repeatedly fail upload). Batch capped at 50 events. On upload failure, incrementFailCount() is called so stuck events don\'t block the queue forever.',
    notes: ['AppDatabase version bumped to 3 — fallbackToDestructiveMigration handles upgrade', 'getPending(): WHERE uploaded=0 AND fail_count<3 LIMIT 50', 'incrementFailCount(eventIds): UPDATE SET fail_count=fail_count+1'],
  },
  {
    id: 'player-pop-retry-fix', cluster: 'Android Player', label: 'POP Upload Retry Fix', sub: 'Stopped silently dropping proof-of-play after 5 retries',
    status: 'built', critical: true,
    description: 'Field-trial audit (pre-ELEVATE-T1) found PopUploadWorker returned Result.success() after 5 failed WorkManager retries — a terminal state, so events sat uploaded=0 forever with no further retry once the retry window elapsed. Any outage longer than a few minutes meant permanent proof-of-play loss. Now transient failures (network, 5xx, timeouts, auth, rate-limit) always return Result.retry(); only a genuine 4xx payload rejection counts toward the existing failCount quarantine.',
    notes: [
      'Also fixed a double-application of the NTP clock offset: PlaybackEngine already records timestamps via NtpSyncManager.now() (pre-corrected), but the uploader was adding prefs.getClockOffsetMs() again before sending — skewing every reported startedAt/endedAt.',
      'Now drains the full offline backlog (up to 10k events, 200 batches of 50) in one worker run instead of one batch of 50 per run, so a multi-day outage clears in a single reconnect.',
      'Quarantined (server-rejected) rows are dropped after 30 days so the local table can\'t grow unbounded.',
    ],
  },
  {
    id: 'player-heartbeat-cadence-fix', cluster: 'Android Player', label: 'Heartbeat Cadence Fix', sub: 'WorkManager clamps periodic work to 15 min, not 1',
    status: 'built', critical: true,
    description: 'HeartbeatScheduler requested a 1-minute PeriodicWorkRequest, but Android silently clamps periodic work to a hard 15-minute floor — no error, no log, the real cadence was always 15 min. Requesting the true interval avoids a misleading reader; the server-side offline threshold (job-health-cron) was raised to 20 min to match.',
  },
  {
    id: 'player-download-job-fix', cluster: 'Android Player', label: 'Release Build Was Broken', sub: 'DownloadJobDao queried a nonexistent column',
    status: 'built', critical: true,
    description: 'DownloadJobDao.totalBytesSum() ran SELECT SUM(size_bytes) FROM download_jobs, but DownloadJob never had a size_bytes column — that field only existed on the unrelated Asset entity. Room\'s KSP query verifier fails the whole build on this, so kspReleaseKotlin — and therefore assembleRelease — could not succeed at all from a clean checkout. Added size_bytes to DownloadJob, populated as soon as the download\'s Content-Length is known, so the download-progress corner in PlaybackActivity gets a real total instead of a broken build.',
  },
  {
    id: 'player-crash-handler', cluster: 'Android Player', label: 'Global Crash Handler', sub: 'AliveApplication + uncaught exception logging',
    status: 'built', critical: true,
    description: 'There was no Application subclass and no Thread.setDefaultUncaughtExceptionHandler anywhere. Being registered as the system HOME app means Android eventually relaunches the player after a crash, but the default path can be slow on some OEM TV builds and left zero trace of why the screen went dark. AliveApplication now logs an Incident row locally (type=UNCAUGHT_EXCEPTION, stack trace) and force-exits immediately so the OS\'s HOME-relaunch fires right away.',
    notes: ['Complements the cross-process WatchdogService (player-watchdog / player-watchdog-xproc, since built) — that one recovers from a frozen main thread by killing and restarting the process; this one catches the crash case and gets a record of it before the process dies.', 'Incident rows are still local-only — nothing uploads or displays them yet; SettingsFragment\'s "reset device" action just clears the table alongside everything else.'],
  },
  {
    id: 'player-doze-exemption', cluster: 'Android Player', label: 'Battery Optimization Exemption', sub: 'One-time Doze/App Standby whitelist request during pairing',
    status: 'built', critical: true,
    description: 'No Doze/App Standby exemption existed anywhere — OemAutostartHelper\'s own comment even claimed "the device-owner battery-optimization exemption covers it," but no code actually requested one. Over a multi-week unattended deployment, aggressive OEM Doze policies can throttle the foreground service, WorkManager jobs, and the watchdog\'s check cadence. PairingActivity.showSuccess() now fires ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS at the same moment it already prompts for OEM autostart permission, while setup staff still has the remote in hand.',
    notes: ['Safe to call on every pairing — no-op once granted, since isIgnoringBatteryOptimizations already reflects that state.', 'Did not attempt a fully silent Device-Owner-only bypass API — couldn\'t verify one with certainty without on-device testing, and an unverified DevicePolicyManager call on a production kiosk fleet is worse than one confirmed physical tap during setup.'],
  },
  {
    id: 'player-screen-off', cluster: 'Android Player', label: 'Screen-Off POP Pause', sub: 'Suspend POP emission when HDMI-CEC turns off display',
    status: 'planned',
    description: 'Register BroadcastReceiver for ACTION_SCREEN_OFF and ACTION_SCREEN_ON. While screen is off: stop emitting ProofEvents (no proof of play on a dark screen), pause ExoPlayer to save resources. Resume on ACTION_SCREEN_ON.',
    notes: ['Must register dynamically (not manifest) — ACTION_SCREEN_OFF not delivered to manifest receivers', 'PlaybackActivity.onResume/onPause already handles config changes; the broadcast covers HDMI-CEC off', 'POP events emitted = 0 while screenOff=true regardless of playback state'],
    claudePrompt: `Task: Add screen-off POP pause to ALIVE Player.

Register a BroadcastReceiver in PlaybackActivity (or the foreground PlaybackService) for Intent.ACTION_SCREEN_OFF and Intent.ACTION_SCREEN_ON.

\`\`\`kotlin
// In PlaybackActivity or PlaybackService:
private var screenOff = false

private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_SCREEN_OFF -> {
                screenOff = true
                playbackEngine.pauseForScreenOff()
            }
            Intent.ACTION_SCREEN_ON -> {
                screenOff = false
                playbackEngine.resumeFromScreenOff()
            }
        }
    }
}

// In onCreate:
registerReceiver(screenReceiver, IntentFilter().apply {
    addAction(Intent.ACTION_SCREEN_OFF)
    addAction(Intent.ACTION_SCREEN_ON)
})

// In onDestroy:
unregisterReceiver(screenReceiver)
\`\`\`

In PlaybackEngine: add pauseForScreenOff() that sets a flag suppressing emitCompleteEvent(), and resumeFromScreenOff() that re-arms.`,
  },
  {
    id: 'player-plan-staleness', cluster: 'Android Player', label: 'Plan Staleness Fallback', sub: 'Detect expired plan + serve offline default',
    status: 'planned',
    description: 'If the cached plan is older than 72 hours (the plan window) and no new plan has been fetched, show a static offline fallback asset instead of playing potentially expired schedule windows.',
    notes: ['PlanLoader checks fetchedAtEpochMs < now - 72h → return fallback plan', 'Fallback: a bundled default_offline.mp4 in res/raw or assets/', 'FetchStatus.NO_CONTENT shown on screen with human-readable countdown'],
    claudePrompt: `Task: Add plan staleness detection to ALIVE Player PlanLoader.

In PlanLoader.kt (or wherever you load from Room), after loading the cached PlanCache:
\`\`\`kotlin
val maxAgeMs = 72 * 60 * 60 * 1000L // 72h matches the server-side plan window
if (existing != null && System.currentTimeMillis() - existing.fetchedAtEpochMs > maxAgeMs) {
    // Plan too old — return a fallback plan so the screen doesn't go blank
    return Plan(windows = emptyList(), fallbackItems = listOf(PlanItem.offline()))
}
\`\`\`

Add PlanItem.offline() companion that returns a local file URI pointing to res/raw/offline_default.mp4 (a short branded "No Schedule" video).`,
  },
  {
    id: 'player-thermal', cluster: 'Android Player', label: 'Thermal Adaptation', sub: 'Detect throttle + downgrade resolution',
    status: 'planned',
    description: 'Use PowerManager.getThermalHeadroom(1) (API 29+) to detect thermal throttling. When headroom < 0.4, downgrade ExoPlayer video quality. When headroom drops below 0.2, suspend video rendering and show static image fallback to prevent forced reboot.',
    notes: ['getThermalHeadroom(1) = forecast 1 second ahead (0.0=critical, 1.0=cool)', 'Check every 30 seconds in a coroutine loop', 'ExoPlayer: setVideoScalingMode or switch to lower-res track via TrackSelector'],
    claudePrompt: `Task: Add thermal adaptation to PlaybackEngine.

\`\`\`kotlin
private fun startThermalMonitor() {
    CoroutineScope(Dispatchers.IO).launch {
        while (isActive) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val headroom = if (Build.VERSION.SDK_INT >= 29) pm.getThermalHeadroom(1) else 1.0f
            mainHandler.post {
                when {
                    headroom < 0.2f -> exoPlayer?.playWhenReady = false  // emergency pause
                    headroom < 0.4f -> exoPlayer?.setForegroundMode(true) // prioritize decode
                    else -> exoPlayer?.playWhenReady = true
                }
            }
            delay(30_000)
        }
    }
}
\`\`\``,
  },
  {
    id: 'player-refresh-rate', cluster: 'Android Player', label: 'Refresh Rate Matching', sub: 'Switch display mode to match content framerate',
    status: 'planned',
    description: 'Read Display.getSupportedModes() and switch to a mode whose refresh rate matches the content\'s framerate (24fps→24/48/120Hz, 30fps→30/60Hz). Reduces judder on 60Hz TVs playing 24fps content. Applied per-item when type is video.',
    notes: ['WindowManager.LayoutParams.preferredDisplayModeId = bestMode.modeId', 'Match by mode.refreshRate divisibility with content fps', 'Only switch if a matching mode exists — no-op otherwise'],
    claudePrompt: `Task: Add refresh rate matching to PlaybackEngine.

\`\`\`kotlin
private fun matchRefreshRate(contentFps: Float) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    val display = (context as? Activity)?.windowManager?.defaultDisplay ?: return
    val modes = display.supportedModes
    val best = modes.filter { it.refreshRate % contentFps < 0.1f }
        .maxByOrNull { it.refreshRate } ?: return
    val params = (context as Activity).window.attributes
    params.preferredDisplayModeId = best.modeId
    (context as Activity).window.attributes = params
}
\`\`\`

Call matchRefreshRate() in renderItem() for video items, using item's declared fps (add fps field to PlanItem, default 30.0f).`,
  },
  {
    id: 'player-watchdog-xproc', cluster: 'Android Player', label: 'Cross-Process Watchdog', sub: 'Heartbeat file, not broadcast — main-thread freezes can\'t block a file write',
    status: 'built',
    description: 'Built with a plain heartbeat file (ProcessHeartbeat.kt) instead of the originally speculated LocalBroadcast: a broadcast send still has to originate from a thread in the potentially-frozen main process, whereas a background coroutine writing a file keeps working even if the main Looper is wedged. PlaybackForegroundService writes the file every 10s from Dispatchers.IO; WatchdogService (separate process) checks every 20s and force-restarts the main process if the file goes stale 90s+.',
    notes: ['This is the same underlying capability as player-watchdog above — one implementation satisfies both roadmap entries.', 'Catches true ANRs (frozen main thread), which PlaybackWatchdog (same-process, Handler-based) cannot detect since it would freeze along with the thing it\'s watching.'],
  },
  {
    id: 'player-input-intercept', cluster: 'Android Player', label: 'Kiosk Input Hardening', sub: 'Intercept back/home/menu/search/recents in PlaybackActivity',
    status: 'built',
    description: 'dispatchKeyEvent override in PlaybackActivity swallows KEYCODE_BACK, KEYCODE_HOME, KEYCODE_MENU, KEYCODE_SEARCH, and KEYCODE_APP_SWITCH. Triple-press Select (KEYCODE_DPAD_CENTER/ENTER) within 2s opens Settings — the maintenance escape hatch, matching the original spec.',
    notes: [
      'KEYCODE_HOME is swallowed for defense-in-depth but this is NOT a reliable block: on a normal (non-lock-task) foreground app, Android routes HOME to the system launcher before dispatchKeyEvent ever sees it. Being the persistent HOME app (OwnerSetup) brings the player back quickly, but a moment of home-screen exposure is possible.',
      'Fully preventing HOME exposure needs startLockTask() + setLockTaskPackages() via DevicePolicyManager — a separate, larger change, not built yet.',
    ],
  },
  {
    id: 'player-firmware-resilience', cluster: 'Android Player', label: 'Firmware Update Resilience', sub: 'Re-register hardwareKey if device identity changes',
    status: 'planned',
    description: 'Some Fire TV firmware updates reset the Android ID, breaking the hardwareKey used for device identity. On startup, compare the current hardwareKey with the stored one. If different, re-register with /api/device/claim and update the stored token.',
    notes: ['hardwareKey = ANDROID_ID (or MAC as fallback)', 'On mismatch: call claim() with new key, store new token, keep all local SQLite data', 'Edge case: two devices swapping keys — backend deduplicates by hardwareKey'],
  },
  {
    id: 'player-burn-in', cluster: 'Android Player', label: 'Burn-In Mitigation', sub: 'Pixel shift + content rotation for long-lived installs',
    status: 'planned',
    description: 'Kiosk screens run 16+ hours/day. Apply subtle pixel shift (±2px) every 5 minutes and rotate logo/bug position to reduce static burn-in on OLED and VA panels commonly used in budget TVs.',
    notes: ['View.animate().translationX(shift) on the container — 2-3px imperceptible shift', 'Track cumulative shift and reset on new content item', 'Not needed for IPS panels (no burn-in), but safe to apply universally'],
  },
  {
    id: 'player-webview-isolation', cluster: 'Android Player', label: 'WebView Process Isolation', sub: 'Run WebView in separate process to prevent main crash',
    status: 'planned',
    description: 'WebView crashes (e.g. from malformed HTML ad creative) can bring down the main process. Wrap WebView in a separate :webview process. If it crashes, only that process dies and the main playback loop skips to the next item.',
    notes: ['AndroidManifest: <activity android:name=".WebViewActivity" android:process=":webview">', 'Use startActivityForResult to load URL in WebViewActivity', 'On onActivityResult: if result OK, advance; if RESULT_CANCELED, skip item'],
  },
  {
    id: 'player-hdcp-probe', cluster: 'Android Player', label: 'HDCP / Codec Probing', sub: 'Detect DRM and codec support at boot, skip incompatible content',
    status: 'planned',
    description: 'Some cheap HDMI receivers enforce HDCP restrictions. MediaDrm.isCryptoSchemeSupported() and MediaCodecList probing at startup builds a device capability map. PlanLoader uses this map to skip DRM-protected items the device can\'t play.',
    notes: ['MediaCodecList(ALL_CODECS).codecInfos — enumerate supported MIME types', 'Store capability bitmap in DevicePrefs for quick lookup at runtime', 'Content marked drm:true in plan response → check capability before queuing'],
  },

  // ── Brand Features T2 ────────────────────────────────────────────────────────
  {
    id: 't2-wallet', cluster: 'Brand Features T2', label: 'Brand Wallet', sub: 'Razorpay top-up + balance',
    status: 't2',
    description: 'Prepaid brand wallet with Razorpay top-up. walletPaise BigInt already on Brand model. Top up via Razorpay standard checkout. Balance deducted per verified play via billing engine.',
    claudePrompt: `Context: Brand model in prisma/schema.prisma already has walletPaise BigInt. Razorpay standard checkout already implemented for campaigns at src/app/api/razorpay/. Brand dashboard at /dashboard.

Task: Build Brand Wallet top-up flow.

## What to build:
1. src/app/api/brand/wallet/topup/route.ts — POST {amount} creates Razorpay order, returns {orderId, amount}
2. src/app/api/razorpay/wallet-verify/route.ts — POST verifies payment, adds to Brand.walletPaise
3. src/app/dashboard — add "Wallet" section showing current balance + "Top Up" button + Razorpay checkout
4. GET /api/brand/wallet — returns {balancePaise, balanceRupees, transactions: [...last 10 debits]}

## Pattern: follow existing src/app/api/razorpay/create-order/route.ts and verify-payment/route.ts
## Atomicity: use db.$transaction for wallet debit to prevent double-spend`,
  },
  {
    id: 't2-builder', cluster: 'Brand Features T2', label: 'Self-Serve Campaign Builder', sub: 'Brand DIY campaign creation',
    status: 't2',
    description: 'Self-serve UI for brands to build and submit campaigns without sales team interaction. Select locations, upload creative, set budget, schedule. Requires creative moderation queue.',
    claudePrompt: `Context: Currently brand campaigns go through the multi-step wizard at /brand-onboarding with Razorpay payment. Self-serve builder would let brands create campaigns entirely on their own including creative upload.

Task: Build self-serve campaign builder as a new section in /dashboard.

## Prerequisite: Creative moderation queue (admin-moderation item) must be built first.

## What to build:
1. /dashboard/new-campaign — multi-step campaign builder
   - Step 1: Target locations (city/zone selector with store count preview)
   - Step 2: Creative upload (direct to R2 via signed URL, video or image, 1920x1080)
   - Step 3: Schedule (date range, daypart)
   - Step 4: Budget (wallet balance shown, cost preview based on screens × days × ₹0.01/sec)
   - Step 5: Submit (deducts from wallet, creates Campaign in DB with status 'pending_review')
2. Submitted campaign → triggers admin moderation queue notification
3. On approval → campaign activates, schedule created, devices updated via next plan poll

## Key APIs: POST /api/campaigns/save, POST /api/content (upload), wallet debit at submission`,
  },
  {
    id: 't2-billing', cluster: 'Brand Features T2', label: 'Billing Engine', sub: 'Per-play debit + auto-pause',
    status: 't2',
    description: 'Debit brand wallet per verified play event. Auto-pause campaign when balance runs low (< 1 day of projected spend). Uses PlayEvent.costPaise field already on the model.',
    claudePrompt: `Context: PlayEvent model already has costPaise field. Brand model has walletPaise BigInt. Billing engine connects these: after each play event batch is received, debit the linked campaign's brand wallet.

Task: Build billing engine as part of the events endpoint.

## Where to add billing logic:
In src/app/api/device/events/route.ts, after saving PlayEvents, add:

\`\`\`ts
// Group events by campaignId/tag
const campaignGroups = groupBy(savedEvents, e => e.tag);
for (const [campaignId, events] of Object.entries(campaignGroups)) {
  if (!campaignId) continue;
  const totalCost = events.reduce((sum, e) => sum + (e.costPaise ?? 0), 0);
  if (totalCost === 0) continue;

  await db.$transaction(async tx => {
    const campaign = await tx.campaign.findUnique({where: {id: campaignId}, include: {brand: true}});
    if (!campaign?.brand) return;

    const newBalance = campaign.brand.walletPaise - BigInt(totalCost);
    await tx.brand.update({where: {id: campaign.brand.id}, data: {walletPaise: newBalance}});

    // Auto-pause if less than 1 day of projected spend remaining
    const dailySpend = totalCost * (86400000 / events[0].durationMs); // rough projection
    if (newBalance < dailySpend) {
      await tx.campaign.update({where: {id: campaignId}, data: {status: 'paused'}});
      // notifyAdminWA + email brand contact
    }
  });
}
\`\`\``,
  },
  {
    id: 't2-audit', cluster: 'Brand Features T2', label: 'Audit Log Service', sub: 'Immutable trail',
    status: 't2',
    description: 'Immutable audit log using prevHash/rowHash chain on AuditLog model. Track all admin actions, payment events, campaign state changes. Verifiable integrity.',
    claudePrompt: `Context: AuditLog model exists in prisma/schema.prisma with prevHash/rowHash fields (same pattern as PlayEvent). This is for T2 compliance and dispute resolution.

Task: Build audit log service.

## What to build:
1. src/lib/audit.ts — logAuditEvent(action, actorId, targetId, data) function that creates AuditLog row with hash chain
2. Wire into: campaign state changes, payout events, device claim/revoke, admin login
3. src/app/api/admin/audit/route.ts — GET audit log with filters (action, actor, target, dateRange)
4. Admin panel: add "Audit Log" section to the Stores or admin page

## Hash chain pattern (copy from PlayEvent in events route):
\`\`\`ts
const prevHash = (await db.auditLog.findFirst({orderBy: {createdAt: 'desc'}}))?.rowHash ?? '0'.repeat(64);
const rowHash = sha256(JSON.stringify({action, actorId, targetId, data, prevHash}));
await db.auditLog.create({data: {action, actorId, targetId, data, prevHash, rowHash}});
\`\`\``,
  },
  {
    id: 't2-remote-ops', cluster: 'Brand Features T2', label: 'Remote Device Ops', sub: 'Reboot/sync via queue',
    status: 't2',
    description: 'Remote reboot, force-sync and config push to devices via a command queue. Admin sends command → stored in DB → device polls and executes → acknowledges.',
    claudePrompt: `Context: Devices poll GET /api/device/plan every 15 min. Remote ops can piggyback on this: plan response includes a 'commands' array that the device processes after fetching content.

Task: Build remote device operations.

## Schema change to prisma/schema.prisma:
\`\`\`prisma
model DeviceCommand {
  id         String   @id @default(cuid())
  deviceId   String
  command    String   // "reboot" | "force-sync" | "update-config"
  payload    Json?
  status     String   @default("pending") // pending | delivered | acknowledged
  createdAt  DateTime @default(now())
  deliveredAt DateTime?
  ackedAt    DateTime?
  device     Device   @relation(fields: [deviceId], references: [id])
  @@index([deviceId, status])
}
\`\`\`

## Backend changes:
1. GET /api/device/plan — append pending commands to response: {items:[...], commands:[{id, command, payload}]}
2. POST /api/device/command/ack — device acknowledges commands after execution
3. POST /api/admin/devices/[id]/command — admin creates command (reboot/force-sync)

## Admin UI: add "Send Command" button in Screens tab dropdown per device card`,
  },
];

// ─── Cluster order ────────────────────────────────────────────────────────────

const CLUSTER_ORDER = [
  'Marketing Site',
  'Store Dashboard',
  'Admin Panel',
  'Device APIs',
  'Background Jobs',
  'Data & Infra',
  'Android Player',
  'Brand Features T2',
];

// ─── Node-graph layout (static — clusters as hubs, items orbiting each hub) ───

const GRAPH_WORLD = 1900; // svg user-unit world size (square)

const GRAPH_LAYOUT = (() => {
  const cx = GRAPH_WORLD / 2;
  const cy = GRAPH_WORLD / 2;
  const hubRadius = 650;
  const clusterPositions: Record<string, { x: number; y: number }> = {};
  CLUSTER_ORDER.forEach((cluster, i) => {
    const angle = (2 * Math.PI * i) / CLUSTER_ORDER.length - Math.PI / 2;
    clusterPositions[cluster] = {
      x: cx + hubRadius * Math.cos(angle),
      y: cy + hubRadius * Math.sin(angle),
    };
  });
  const itemPositions: Record<string, { x: number; y: number }> = {};
  CLUSTER_ORDER.forEach(cluster => {
    const items = ITEMS.filter(i => i.cluster === cluster);
    const orbit = Math.min(220, 60 + items.length * 7);
    const hub = clusterPositions[cluster];
    items.forEach((item, idx) => {
      const angle = (2 * Math.PI * idx) / items.length - Math.PI / 2;
      itemPositions[item.id] = {
        x: hub.x + orbit * Math.cos(angle),
        y: hub.y + orbit * Math.sin(angle),
      };
    });
  });
  return { cx, cy, clusterPositions, itemPositions };
})();

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { label: string; dot: string; badge: string }> = {
  'built':       { label: 'Built',        dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700 border border-green-200'   },
  'in-progress': { label: 'In Progress',  dot: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-700 border border-amber-200'   },
  'planned':     { label: 'Planned (T1)', dot: 'bg-blue-500',   badge: 'bg-blue-50 text-blue-700 border border-blue-200'     },
  't2':          { label: 'T2 Future',    dot: 'bg-purple-500', badge: 'bg-purple-50 text-purple-700 border border-purple-200' },
};

const STATUS_BADGE_VARIANT: Record<Status, 'success' | 'warning' | 'info' | 'purple'> = {
  'built':       'success',
  'in-progress': 'warning',
  'planned':     'info',
  't2':          'purple',
};

// SVG fill/stroke classes per status, used by the node-graph view.
const GRAPH_STATUS_COLOR: Record<Status, { fill: string; edge: string }> = {
  'built':       { fill: 'fill-green-500',  edge: 'stroke-green-300'  },
  'in-progress': { fill: 'fill-amber-500',  edge: 'stroke-amber-300'  },
  'planned':     { fill: 'fill-blue-500',   edge: 'stroke-blue-300'   },
  't2':          { fill: 'fill-purple-500', edge: 'stroke-purple-300' },
};

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all',         label: 'All' },
  { value: 'built',       label: 'Built' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'planned',     label: 'Planned (T1)' },
  { value: 't2',          label: 'T2 Future' },
];

const NOTES_KEY = 'alive_roadmap_notes';

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoadmapTab() {
  const [filter, setFilter]         = useState<FilterValue>('all');
  const [notes, setNotes]           = useState<Record<string, string>>({});
  const [selected, setSelected]     = useState<RoadmapItem | null>(null);
  const [panelNote, setPanelNote]   = useState('');
  const [copied, setCopied]         = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedAll, setCopiedAll]   = useState(false);
  const [copiedCtx, setCopiedCtx]   = useState(false);
  const [showCtx, setShowCtx]       = useState(false);
  const [view, setView]             = useState<'list' | 'map'>('map');
  const [zoom, setZoom]             = useState(1);
  const [pan, setPan]               = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const dragRef  = useRef({ dragging: false, startX: 0, startY: 0, moved: false, panStart: { x: 0, y: 0 } });

  // Grant milestone tracker — live fleet data, separate from the static ITEMS map above.
  const [pairedDevices, setPairedDevices]   = useState<Device[] | null>(null);
  const [devicesEver, setDevicesEver]       = useState<Device[] | null>(null);

  useEffect(() => {
    Promise.all([getDevices(), getDevices({ all: 'true' })])
      .then(([paired, all]) => { setPairedDevices(paired.devices); setDevicesEver(all.devices); })
      .catch(() => { setPairedDevices([]); setDevicesEver([]); });
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (raw) setNotes(JSON.parse(raw) as Record<string, string>);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (selected) setPanelNote(notes[selected.id] ?? '');
  }, [selected, notes]);

  // ── Node-graph pan/zoom ──────────────────────────────────────────────────
  const resetView = useCallback(() => {
    const rect = graphRef.current?.getBoundingClientRect();
    if (!rect) return;
    const k = Math.min(rect.width, rect.height) / GRAPH_WORLD * 0.92;
    setZoom(k);
    setPan({ x: rect.width / 2 - GRAPH_LAYOUT.cx * k, y: rect.height / 2 - GRAPH_LAYOUT.cy * k });
  }, []);

  useEffect(() => {
    if (view !== 'map') return;
    resetView();
    const onResize = () => resetView();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [view, resetView]);

  useEffect(() => {
    const el = graphRef.current;
    if (!el || view !== 'map') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(prevZoom => {
        const newZoom = Math.min(2.5, Math.max(0.15, prevZoom * factor));
        setPan(prevPan => ({
          x: mx - (mx - prevPan.x) * (newZoom / prevZoom),
          y: my - (my - prevPan.y) * (newZoom / prevZoom),
        }));
        return newZoom;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view]);

  const zoomBy = useCallback((factor: number) => {
    const rect = graphRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setZoom(prevZoom => {
      const newZoom = Math.min(2.5, Math.max(0.15, prevZoom * factor));
      setPan(prevPan => ({
        x: cx - (cx - prevPan.x) * (newZoom / prevZoom),
        y: cy - (cy - prevPan.y) * (newZoom / prevZoom),
      }));
      return newZoom;
    });
  }, []);

  const onGraphPointerDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, moved: false, panStart: { ...pan } };
  }, [pan]);

  const onGraphPointerMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
    setPan({ x: dragRef.current.panStart.x + dx, y: dragRef.current.panStart.y + dy });
  }, []);

  const onGraphPointerUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const handleNodeClick = useCallback((item: RoadmapItem) => () => {
    if (dragRef.current.moved) return;
    setSelected(item);
  }, []);

  const saveNote = useCallback(() => {
    if (!selected) return;
    const updated = { ...notes, [selected.id]: panelNote };
    if (!panelNote) delete updated[selected.id];
    setNotes(updated);
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  }, [selected, panelNote, notes]);

  const copyPrompt = useCallback(() => {
    if (!selected?.claudePrompt) return;
    const selfUpdate = [
      '',
      '---',
      '## REQUIRED: Update Platform Map after implementing',
      `File to edit: src/components/admin/roadmap-tab.tsx`,
      `Find the ITEMS array entry with \`id: '${selected.id}'\``,
      `Change its \`status\` from \`'${selected.status}'\` to \`'built'\``,
      `Commit message: "mark ${selected.label} as built in platform map"`,
      '',
      '## Verification before marking built',
      '1. Run: npx tsc --noEmit — must pass with zero errors',
      '2. Run: npm run build — must complete without errors',
      selected.path ? `3. Open ${selected.path} and confirm the feature renders correctly` : '3. Confirm the feature is reachable and renders without errors',
      '4. Git push to branch claude/build-alive-advertising-platform-tlG96',
      '5. Check wearealive.in/admin → Platform Map tab — item should show green "Built" badge',
    ].join('\n');

    const full = [
      PLATFORM_CONTEXT,
      '---',
      `# Task: ${selected.label}`,
      `Item ID: ${selected.id}`,
      `Cluster: ${selected.cluster}`,
      `Current status: ${STATUS_CONFIG[selected.status].label}`,
      selected.path ? `Primary file: ${selected.path}` : '',
      '',
      selected.claudePrompt,
      notes[selected.id] ? `\n## Admin note (added context):\n${notes[selected.id]}` : '',
      selfUpdate,
    ].filter(Boolean).join('\n');
    void navigator.clipboard.writeText(full).then(() => {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2500);
    });
  }, [selected, notes]);

  const copyBrief = useCallback(() => {
    if (!selected) return;
    const text = [
      `**Item: ${selected.label}** (${selected.cluster})`,
      selected.sub,
      `Status: ${STATUS_CONFIG[selected.status].label}`,
      selected.path ? `Path: ${selected.path}` : null,
      selected.description ? `\n${selected.description}` : null,
      notes[selected.id] ? `\nNote: ${notes[selected.id]}` : null,
    ].filter(v => v !== null).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [selected, notes]);

  const copyAllNotes = useCallback(() => {
    const dated = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const itemsWithNotes = ITEMS.filter(item => notes[item.id]);
    if (!itemsWithNotes.length) { alert('No notes added yet.'); return; }
    const lines = [
      `# ALIVE Platform Notes — ${dated}`,
      '',
      '## Items needing attention:',
      '',
      ...itemsWithNotes.flatMap(item => [
        `**${item.label}** (${item.cluster}) — ${STATUS_CONFIG[item.status].label}`,
        item.path ? `Path: ${item.path}` : '',
        `Note: ${notes[item.id]}`,
        '',
      ]).filter(Boolean),
    ];
    void navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    });
  }, [notes]);

  const copyPlatformContext = useCallback(() => {
    const dated = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const inProgress = ITEMS.filter(i => i.status === 'in-progress').map(i => `- ${i.label}: ${i.sub}`).join('\n');
    const planned    = ITEMS.filter(i => i.status === 'planned').map(i => `- ${i.label}: ${i.sub}`).join('\n');
    const withNotes  = ITEMS.filter(i => notes[i.id]).map(i => `- ${i.label}: ${notes[i.id]}`).join('\n');
    const full = [
      PLATFORM_CONTEXT,
      `\n## Session date: ${dated}`,
      inProgress ? `\n## In Progress (needs finishing):\n${inProgress}` : '',
      planned    ? `\n## T1 Planned (not yet started):\n${planned}` : '',
      withNotes  ? `\n## Admin notes on specific items:\n${withNotes}` : '',
      '\n## Where to start:\nLook at the "In Progress" items first — these are partially built and need wiring. Then tackle "Planned T1" in RICE score order: NTPSyncManager > POPEmitter > PlaybackEngine > SyncManager > WatchdogService > SystemLauncher.',
      '\n## MANDATORY: After implementing any item\nUpdate src/components/admin/roadmap-tab.tsx — find the ITEMS entry by id and change its status to \'built\'. This is how the Platform Map at wearealive.in/admin stays accurate. Commit the status change in the same commit or immediately after.',
    ].filter(Boolean).join('\n');
    void navigator.clipboard.writeText(full).then(() => {
      setCopiedCtx(true);
      setTimeout(() => setCopiedCtx(false), 2500);
    });
  }, [notes]);

  // Stats
  const t1Items         = ITEMS.filter(i => i.status !== 't2');
  const builtCount      = ITEMS.filter(i => i.status === 'built').length;
  const inProgressCount = ITEMS.filter(i => i.status === 'in-progress').length;
  const plannedCount    = ITEMS.filter(i => i.status === 'planned').length;
  const t2Count         = ITEMS.filter(i => i.status === 't2').length;
  const t1Built         = t1Items.filter(i => i.status === 'built').length;
  const progressPct     = Math.round((t1Built / t1Items.length) * 100);
  const noteCount       = Object.keys(notes).length;

  const visibleItems = filter === 'all' ? ITEMS : ITEMS.filter(i => i.status === filter);
  const clusters     = CLUSTER_ORDER.filter(c => visibleItems.some(i => i.cluster === c));

  // Grant milestone: screens that are paired, meeting the uptime bar, AND actually
  // producing proof-of-play recently — not just "online" at this instant.
  const milestoneLoading = pairedDevices === null || devicesEver === null;
  const provisionedCount = devicesEver?.length ?? 0;
  const pairedCount      = pairedDevices?.length ?? 0;
  const onlineNowCount    = pairedDevices?.filter(d => d.status === 'ONLINE').length ?? 0;
  const reliableCount     = pairedDevices?.filter(d =>
    (d.uptimePct ?? 0) >= GRANT_MIN_UPTIME_PCT &&
    d.lastPlayAt != null &&
    Date.now() - new Date(d.lastPlayAt).getTime() < GRANT_POP_WINDOW_MS
  ).length ?? 0;
  const milestonePct = Math.min(100, Math.round((reliableCount / GRANT_TARGET_SCREENS) * 100));

  return (
    <div className="space-y-5">

      {/* Grant milestone tracker */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">Karnataka ELEVATE T1 — Grant Milestone</span>
          <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${milestoneLoading ? 0 : milestonePct}%` }} />
          </div>
          <span className="text-xs font-bold text-primary shrink-0">
            {milestoneLoading ? '—' : `${reliableCount} / ${GRANT_TARGET_SCREENS}`}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Reliable = paired · ≥{GRANT_MIN_UPTIME_PCT}% 30-day uptime · proof-of-play in the last 24h
        </p>
        <div className="admin-summary-row" style={{ marginBottom: 0 }}>
          {[
            { label: 'Provisioned', value: milestoneLoading ? '—' : String(provisionedCount) },
            { label: 'Paired',      value: milestoneLoading ? '—' : String(pairedCount) },
            { label: 'Online now',  value: milestoneLoading ? '—' : String(onlineNowCount) },
            { label: 'Grant-ready', value: milestoneLoading ? '—' : String(reliableCount) },
          ].map((s) => (
            <div key={s.label} className="admin-summary-tile">
              <div className="admin-summary-tile__label">{s.label}</div>
              <div className="admin-summary-tile__value" style={{ fontSize: 22 }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">T1 Progress</span>
            <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-xs font-bold text-green-600 shrink-0">{progressPct}%</span>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px]">
            <span className="text-green-600 font-semibold">{builtCount} built</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-amber-600 font-semibold">{inProgressCount} in progress</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-blue-600 font-semibold">{plannedCount} planned</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-purple-600 font-semibold">{t2Count} t2</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Copy platform context */}
          <button
            onClick={copyPlatformContext}
            className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors shrink-0"
          >
            {copiedCtx ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Zap className="h-3.5 w-3.5" />}
            {copiedCtx ? 'Copied!' : 'Copy Platform Starter'}
          </button>
          {/* Copy all notes */}
          <button
            onClick={copyAllNotes}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            {copiedAll ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedAll ? 'Copied!' : `Copy notes${noteCount > 0 ? ` (${noteCount})` : ''}`}
          </button>
        </div>
      </div>

      {/* Platform context banner */}
      <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
        <button
          onClick={() => setShowCtx(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        >
          <div>
            <span className="text-xs font-bold text-foreground">How to continue with Claude</span>
            <span className="ml-2 text-[10px] text-muted-foreground">Click any item → copy its implementation prompt</span>
          </div>
          {showCtx ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        {showCtx && (
          <div className="px-4 pb-4 space-y-3 text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
            <p><strong className="text-foreground">Step 1 — Copy prompt:</strong> Click any item → <strong className="text-primary">Copy Claude Prompt</strong>. This copies full platform context + implementation instructions + item ID + verification checklist in one block.</p>
            <p><strong className="text-foreground">Step 2 — Run in Claude:</strong> Paste into a new Claude session. Claude implements the feature, runs <code className="bg-muted px-1 rounded text-[10px]">npx tsc --noEmit</code> + <code className="bg-muted px-1 rounded text-[10px]">npm run build</code>, commits, and pushes to the branch.</p>
            <p><strong className="text-foreground">Step 3 — Map updates itself:</strong> The prompt tells Claude to edit <code className="bg-muted px-1 rounded text-[10px]">roadmap-tab.tsx</code> and change the item&apos;s status to <span className="text-green-600 font-semibold">&apos;built&apos;</span> in the same commit. When Vercel deploys, this tab reflects the new state automatically.</p>
            <p><strong className="text-foreground">Step 4 — Verify here:</strong> Refresh this page after deploy. The item should show a green dot. If it still shows planned/in-progress, Claude skipped the self-update step — run the prompt again and ask Claude to only do the roadmap update.</p>
            <p><strong className="text-foreground">For a fresh session:</strong> Use <strong className="text-primary">Copy Platform Starter</strong> to give Claude full context without targeting a specific item.</p>
            <p><strong className="text-foreground">In Progress items:</strong> Start with <strong>WhatsApp Alerts</strong> and <strong>Auto Remediation</strong> — both are 80% wired, the prompts have exact line-level instructions.</p>
          </div>
        )}
      </div>

      {/* Filter pills + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold border transition-all ${
                filter === f.value
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border p-0.5 shrink-0">
          <button
            onClick={() => setView('map')}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              view === 'map' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MapIcon className="h-3.5 w-3.5" /> Map
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              view === 'list' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ListIcon className="h-3.5 w-3.5" /> List
          </button>
        </div>
      </div>

      {/* Node-graph (Platform Map) view */}
      {view === 'map' && (
        <div
          ref={graphRef}
          className="relative w-full h-[640px] overflow-hidden rounded-xl border border-border bg-muted/20 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onGraphPointerDown}
          onMouseMove={onGraphPointerMove}
          onMouseUp={onGraphPointerUp}
          onMouseLeave={onGraphPointerUp}
        >
          <div
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: GRAPH_WORLD, height: GRAPH_WORLD }}
          >
            <svg width={GRAPH_WORLD} height={GRAPH_WORLD} viewBox={`0 0 ${GRAPH_WORLD} ${GRAPH_WORLD}`}>
              {/* Edges: hub → item */}
              {CLUSTER_ORDER.map(cluster => {
                const hub = GRAPH_LAYOUT.clusterPositions[cluster];
                return visibleItems.filter(i => i.cluster === cluster).map(item => {
                  const p = GRAPH_LAYOUT.itemPositions[item.id];
                  return (
                    <line
                      key={`edge-${item.id}`}
                      x1={hub.x} y1={hub.y} x2={p.x} y2={p.y}
                      className={`${GRAPH_STATUS_COLOR[item.status].edge} ${hoveredId === item.id ? 'opacity-90' : 'opacity-30'}`}
                      strokeWidth={hoveredId === item.id ? 2.5 : 1.5}
                    />
                  );
                });
              })}

              {/* Hub nodes (clusters) */}
              {CLUSTER_ORDER.filter(c => clusters.includes(c)).map(cluster => {
                const hub = GRAPH_LAYOUT.clusterPositions[cluster];
                const clusterItems = ITEMS.filter(i => i.cluster === cluster);
                const built = clusterItems.filter(i => i.status === 'built').length;
                return (
                  <g key={`hub-${cluster}`}>
                    <circle cx={hub.x} cy={hub.y} r={34} className="fill-card stroke-primary" strokeWidth={2} />
                    <text x={hub.x} y={hub.y - 4} textAnchor="middle" className="fill-foreground text-[15px] font-bold" style={{ fontFamily: 'inherit' }}>
                      {cluster}
                    </text>
                    <text x={hub.x} y={hub.y + 14} textAnchor="middle" className="fill-muted-foreground text-[12px]">
                      {built}/{clusterItems.length} built
                    </text>
                  </g>
                );
              })}

              {/* Item nodes */}
              {visibleItems.map(item => {
                const p = GRAPH_LAYOUT.itemPositions[item.id];
                const sc = GRAPH_STATUS_COLOR[item.status];
                const isHovered = hoveredId === item.id;
                return (
                  <g
                    key={item.id}
                    transform={`translate(${p.x}, ${p.y})`}
                    onClick={handleNodeClick(item)}
                    onMouseEnter={() => setHoveredId(item.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className="cursor-pointer"
                  >
                    <circle r={isHovered ? 12 : 9} className={`${sc.fill} stroke-white`} strokeWidth={2} />
                    {item.critical && <circle r={isHovered ? 17 : 14} className="fill-none stroke-red-400" strokeWidth={1.5} strokeDasharray="3 3" />}
                    <text
                      x={0} y={isHovered ? -20 : -16}
                      textAnchor="middle"
                      className={`fill-foreground text-[13px] font-semibold transition-opacity ${isHovered ? 'opacity-100' : 'opacity-70'}`}
                    >
                      {item.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1">
            <button onClick={() => zoomBy(1.25)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shadow-sm">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button onClick={() => zoomBy(1 / 1.25)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shadow-sm">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button onClick={resetView} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shadow-sm">
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-[10px] font-semibold backdrop-blur-sm">
            {(Object.keys(STATUS_CONFIG) as Status[]).map(s => (
              <span key={s} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${STATUS_CONFIG[s].dot}`} />
                {STATUS_CONFIG[s].label}
              </span>
            ))}
          </div>

          {/* Hint */}
          <div className="absolute top-3 left-3 text-[10px] text-muted-foreground/70 font-medium">
            Scroll to zoom · drag to pan · click a node for details
          </div>
        </div>
      )}

      {/* Clusters (list view) */}
      {view === 'list' && (
      <div className="space-y-8">
        {clusters.map(cluster => {
          const clusterItems = visibleItems.filter(i => i.cluster === cluster);
          const clusterNotes = clusterItems.filter(i => notes[i.id]).length;
          return (
            <div key={cluster}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{cluster}</h2>
                {clusterNotes > 0 && (
                  <Badge variant="warning" className="text-[10px] py-0.5 px-2 font-bold">
                    <MessageSquare className="h-2.5 w-2.5" />
                    {clusterNotes} {clusterNotes === 1 ? 'note' : 'notes'}
                  </Badge>
                )}
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {clusterItems.map(item => {
                  const sc = STATUS_CONFIG[item.status];
                  const hasNote   = !!notes[item.id];
                  const hasPrompt = !!item.claudePrompt;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelected(item)}
                      className="text-left rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-all p-3 group"
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${sc.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                              {item.label}
                            </span>
                            {item.critical && (
                              <Badge variant="error" className="px-1.5 py-px text-[9px] font-bold uppercase leading-tight shrink-0">
                                critical
                              </Badge>
                            )}
                            {hasPrompt && (
                              <Badge variant="brand" className="px-1.5 py-px text-[9px] font-bold leading-tight shrink-0">
                                prompt
                              </Badge>
                            )}
                            {hasNote && (
                              <MessageSquare className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                            {item.sub}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Detail panel */}
      {selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelected(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-[420px] bg-card border-l border-border flex flex-col shadow-xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant={STATUS_BADGE_VARIANT[selected.status]} className="px-2 py-0.5 text-[10px] font-bold">
                    {STATUS_CONFIG[selected.status].label}
                  </Badge>
                  {selected.critical && (
                    <Badge variant="error" className="px-1.5 py-px text-[9px] font-bold uppercase">critical</Badge>
                  )}
                </div>
                <h3 className="text-base font-bold text-foreground leading-tight">{selected.label}</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{selected.sub}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Cluster */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Cluster</p>
                <p className="text-sm text-foreground">{selected.cluster}</p>
              </div>

              {/* Path */}
              {selected.path && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">File</p>
                  <code className="text-xs bg-muted rounded px-2 py-1 text-foreground break-all block">{selected.path}</code>
                </div>
              )}

              {/* Description */}
              {selected.description && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Description</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{selected.description}</p>
                </div>
              )}

              {/* Notes from data */}
              {selected.notes && selected.notes.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Technical notes</p>
                  <ul className="space-y-1">
                    {selected.notes.map((n, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Claude prompt preview */}
              {selected.claudePrompt && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Claude Prompt</p>
                    <span className="text-[10px] text-muted-foreground/60">includes full platform context</span>
                  </div>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {selected.claudePrompt.slice(0, 600)}{selected.claudePrompt.length > 600 ? '…' : ''}
                  </div>
                  <button
                    onClick={copyPrompt}
                    className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors"
                  >
                    {copiedPrompt ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                    {copiedPrompt ? 'Copied — paste to Claude!' : 'Copy Claude Prompt (with full context)'}
                  </button>
                </div>
              )}

              {/* Admin note textarea */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Your note (appended to prompt)</p>
                <textarea
                  value={panelNote}
                  onChange={e => setPanelNote(e.target.value)}
                  placeholder="What needs attention? What's blocking? Add context here — it gets included when you copy the prompt."
                  rows={3}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                />
                <button
                  onClick={saveNote}
                  className="mt-1.5 w-full rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/60 transition-colors"
                >
                  Save note
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border">
              <button
                onClick={copyBrief}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : 'Copy brief (no context)'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
