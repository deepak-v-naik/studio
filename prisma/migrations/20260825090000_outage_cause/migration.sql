-- Outage cause diagnosis: "why is this screen offline — power, network, or the player?"
--
-- Device.appStartedAt is the companion to bootedAt: bootedAt says whether the BOX
-- restarted, appStartedAt whether the APP did. Only the pair separates the three
-- causes; either alone is ambiguous.
--
-- The DeviceAlert.*Before columns snapshot the pre-outage values at the moment the
-- alert opens. They are not redundant with the Device columns: those are overwritten
-- by every heartbeat, so by the time a screen comes back there is no "before" value
-- left to diff against unless it was frozen on the alert row.
--
-- IF NOT EXISTS throughout, matching the surrounding migrations: these run via
-- `prisma migrate deploy` during the Vercel build, and a re-run against a database
-- where a column already exists must not fail the deploy.
ALTER TABLE "Device"      ADD COLUMN IF NOT EXISTS "appStartedAt"     TIMESTAMP(3);

ALTER TABLE "DeviceAlert" ADD COLUMN IF NOT EXISTS "bootedAtBefore"   TIMESTAMP(3);
ALTER TABLE "DeviceAlert" ADD COLUMN IF NOT EXISTS "appStartedBefore" TIMESTAMP(3);
ALTER TABLE "DeviceAlert" ADD COLUMN IF NOT EXISTS "appVersionBefore" TEXT;
ALTER TABLE "DeviceAlert" ADD COLUMN IF NOT EXISTS "cause"            TEXT;
ALTER TABLE "DeviceAlert" ADD COLUMN IF NOT EXISTS "causeConfidence"  TEXT;
ALTER TABLE "DeviceAlert" ADD COLUMN IF NOT EXISTS "causeEvidence"    TEXT;
