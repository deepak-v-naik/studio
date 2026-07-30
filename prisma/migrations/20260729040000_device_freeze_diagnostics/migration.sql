-- Freeze diagnostics: distinguish "network alive" (lastSeen) from "content still
-- advancing" (playbackAliveAt). A frozen screen keeps heartbeating, so lastSeen
-- alone cannot detect it.
ALTER TABLE "Device" ADD COLUMN "playbackAliveAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "lastStallReason" TEXT;
ALTER TABLE "Device" ADD COLUMN "lastStallAt" TIMESTAMP(3);
