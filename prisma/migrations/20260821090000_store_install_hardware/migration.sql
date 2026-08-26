-- Per-store installation & hardware record: the physical TV asset (brand, size,
-- ALIVE tag, install date) plus the site's ESP switch label and WiFi, captured by
-- ops at the site visit and shown on the partner's card in the admin panel.
--
-- On Store rather than Device on purpose: deleting a screen in admin drops the
-- Device row (decommission flow) and a re-paired screen claims a fresh one, so
-- Device-held asset data is lost on every re-pair. One screen per store makes
-- the store the unambiguous owner.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS) to match house style — these run inside
-- the Vercel build, where a migration failure breaks the deploy.

ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "tvBrand"       TEXT,
  ADD COLUMN IF NOT EXISTS "tvSizeInches"  INTEGER,
  ADD COLUMN IF NOT EXISTS "tvTag"         TEXT,
  ADD COLUMN IF NOT EXISTS "tvInstalledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "espSwitchName" TEXT,
  ADD COLUMN IF NOT EXISTS "wifiSsid"      TEXT,
  ADD COLUMN IF NOT EXISTS "wifiPassword"  TEXT,
  ADD COLUMN IF NOT EXISTS "installNotes"  TEXT;

-- Asset tags are looked up when a technician reports "TV number 27 is dark".
-- Partial index: only rows that actually carry a tag.
CREATE INDEX IF NOT EXISTS "Store_tvTag_idx" ON "Store"("tvTag") WHERE "tvTag" IS NOT NULL;
