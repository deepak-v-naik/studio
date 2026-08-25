-- eWeLink smart plug integration: linked-account singleton, per-device plug
-- link, and power/energy readings time series.
--
-- Idempotent throughout (CREATE ... IF NOT EXISTS, guarded FK) to match the
-- house style: these run inside the Vercel build, where a failure breaks deploy.

CREATE TABLE IF NOT EXISTS "EwelinkAccount" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "region" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "atExpiresAt" TIMESTAMP(3),
    "rtExpiresAt" TIMESTAMP(3),
    "needsReauth" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EwelinkAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SmartPlug" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ewelinkDeviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productModel" TEXT,
    "uiid" INTEGER,
    "supportsEnergy" BOOLEAN NOT NULL DEFAULT false,
    "ratedWatts" DOUBLE PRECISION,
    "online" BOOLEAN,
    "switchOn" BOOLEAN,
    "powerW" DOUBLE PRECISION,
    "voltageV" DOUBLE PRECISION,
    "currentA" DOUBLE PRECISION,
    "lastPolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmartPlug_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlugReading" (
    "id" TEXT NOT NULL,
    "plugId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "online" BOOLEAN NOT NULL,
    "switchOn" BOOLEAN NOT NULL,
    "powerW" DOUBLE PRECISION,
    "energyWh" DOUBLE PRECISION,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PlugReading_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmartPlug_deviceId_key" ON "SmartPlug"("deviceId");
CREATE UNIQUE INDEX IF NOT EXISTS "SmartPlug_ewelinkDeviceId_key" ON "SmartPlug"("ewelinkDeviceId");
CREATE INDEX IF NOT EXISTS "PlugReading_plugId_at_idx" ON "PlugReading"("plugId", "at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SmartPlug_deviceId_fkey') THEN
    ALTER TABLE "SmartPlug" ADD CONSTRAINT "SmartPlug_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlugReading_plugId_fkey') THEN
    ALTER TABLE "PlugReading" ADD CONSTRAINT "PlugReading_plugId_fkey"
      FOREIGN KEY ("plugId") REFERENCES "SmartPlug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
