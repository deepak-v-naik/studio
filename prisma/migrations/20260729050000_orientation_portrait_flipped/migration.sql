-- Portrait is the standard ALIVE mount, so it becomes the default rather than AUTO.
ALTER TYPE "DeviceOrientation" ADD VALUE 'PORTRAIT_FLIPPED';
ALTER TABLE "Device" ALTER COLUMN "orientation" SET DEFAULT 'PORTRAIT';

-- Screens still sitting on the previous AUTO default never had an orientation
-- deliberately chosen (the field was not applied by the player until recently), so
-- move them to the intended portrait mount. LANDSCAPE / PORTRAIT / PORTRAIT_FLIPPED
-- are left alone: those are explicit operator choices.
UPDATE "Device" SET "orientation" = 'PORTRAIT' WHERE "orientation" = 'AUTO';
