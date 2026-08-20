-- Screen-offline alerts + partner web-push subscriptions.
-- DeviceAlert is one row per offline INCIDENT (opened at the offline edge,
-- resolved when the screen heartbeats again) so the admin panel can pop a
-- notification and the partner can be told once the outage is sustained.
-- PushSubscription holds partner browser Push API subscriptions — partners have
-- no email, so push is the only channel that reaches them without a template.
--
-- Idempotent throughout (CREATE ... IF NOT EXISTS, guarded enum/FK) to match the
-- house style: these run inside the Vercel build, where a failure breaks deploy.

DO $$ BEGIN
  CREATE TYPE "DeviceAlertStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "DeviceAlert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "storeId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OFFLINE',
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "status" "DeviceAlertStatus" NOT NULL DEFAULT 'OPEN',
    "deviceName" TEXT NOT NULL,
    "storeName" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "downtimeSec" INTEGER,
    "adminReadAt" TIMESTAMP(3),
    "partnerNotifiedAt" TIMESTAMP(3),
    "partnerReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeviceAlert_status_createdAt_idx" ON "DeviceAlert"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "DeviceAlert_storeId_status_createdAt_idx" ON "DeviceAlert"("storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "DeviceAlert_deviceId_status_idx" ON "DeviceAlert"("deviceId", "status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeviceAlert_deviceId_fkey') THEN
    ALTER TABLE "DeviceAlert" ADD CONSTRAINT "DeviceAlert_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOkAt" TIMESTAMP(3),
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_storeId_idx" ON "PushSubscription"("storeId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscription_storeId_fkey') THEN
    ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The 5-minute offline sweep filters on (status, lastSeen); without this it
-- scans the whole Device table every run.
CREATE INDEX IF NOT EXISTS "Device_status_lastSeen_idx" ON "Device"("status", "lastSeen");
