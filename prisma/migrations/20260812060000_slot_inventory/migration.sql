-- Slot-loop inventory: fixed loop of N 10s ad slots per store, sold by position+date.
-- Store gains slot-mode config (loopSlotCount null = slot mode off), Campaign gains its
-- 10s slot creative, PlayEvent gains slot attribution (the spec's play_logs), and
-- SlotBooking holds the sold inventory.

ALTER TABLE "Store" ADD COLUMN "loopSlotCount" INTEGER;
ALTER TABLE "Store" ADD COLUMN "openDays" INTEGER NOT NULL DEFAULT 127;
ALTER TABLE "Store" ADD COLUMN "hoursStart" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "Store" ADD COLUMN "hoursEnd" TEXT NOT NULL DEFAULT '21:00';
ALTER TABLE "Store" ADD COLUMN "fillerCampaignId" TEXT;
ALTER TABLE "Store" ADD CONSTRAINT "Store_fillerCampaignId_fkey"
  FOREIGN KEY ("fillerCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Campaign" ADD COLUMN "slotContentId" TEXT;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_slotContentId_fkey"
  FOREIGN KEY ("slotContentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayEvent" ADD COLUMN "slotPosition" INTEGER;
ALTER TABLE "PlayEvent" ADD COLUMN "isFiller" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SlotBooking" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slotPosition" INTEGER NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotBooking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SlotBooking_campaignId_idx" ON "SlotBooking"("campaignId");
CREATE INDEX "SlotBooking_date_idx" ON "SlotBooking"("date");
CREATE UNIQUE INDEX "SlotBooking_storeId_date_slotPosition_key" ON "SlotBooking"("storeId", "date", "slotPosition");

ALTER TABLE "SlotBooking" ADD CONSTRAINT "SlotBooking_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlotBooking" ADD CONSTRAINT "SlotBooking_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerConfig" ADD COLUMN "fillerCampaignId" TEXT;
