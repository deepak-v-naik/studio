-- CreateTable
CREATE TABLE "PlayerConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "retryIntervalMs" INTEGER NOT NULL DEFAULT 30000,
    "transitionDurationMs" INTEGER NOT NULL DEFAULT 600,
    "kioskKeyLockEnabled" BOOLEAN NOT NULL DEFAULT true,
    "downloadConnectTimeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "downloadReadTimeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row with defaults matching the player's previous hardcoded values
INSERT INTO "PlayerConfig" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);
