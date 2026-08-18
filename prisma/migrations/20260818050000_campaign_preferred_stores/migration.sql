-- AlterTable: brand-picked store ids from the onboarding map picker.
-- Hint for ops slot assignment; not a reservation.
ALTER TABLE "Campaign" ADD COLUMN "preferredStoreIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
