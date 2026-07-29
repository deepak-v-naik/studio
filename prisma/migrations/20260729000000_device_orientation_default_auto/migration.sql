-- Device.orientation has never actually been applied by the player (it was fetched
-- into the admin UI but never sent down /api/device/plan), so every existing row
-- sitting at the old default of LANDSCAPE reflects Prisma's schema default, not a
-- deliberate admin choice. Now that the plan API sends orientation to the player,
-- reset those untouched rows to AUTO ("defer to the device's local/on-site
-- orientation") instead of retroactively forcing every screen to landscape --
-- including ones a field technician already set to portrait via the on-device
-- 5-tap rotate control.
ALTER TABLE "Device" ALTER COLUMN "orientation" SET DEFAULT 'AUTO';

UPDATE "Device" SET "orientation" = 'AUTO' WHERE "orientation" = 'LANDSCAPE';
