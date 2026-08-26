-- Design inversion after adversarial review: the transcode callback KEEPS overwriting
-- objectKey with the safe rendition (legacy shape — a Vercel rollback to pre-rendition
-- code then still serves the safe file, never a raw original a budget panel can't
-- decode), and these columns instead preserve the pre-overwrite ORIGINAL for
-- Device.playsOriginal screens. Pure rename: the h264* columns from the previous
-- migration were never written by any deployed code.
ALTER TABLE "Content" RENAME COLUMN "h264ObjectKey" TO "originalObjectKey";
ALTER TABLE "Content" RENAME COLUMN "h264Md5" TO "originalMd5";
ALTER TABLE "Content" RENAME COLUMN "h264SizeBytes" TO "originalSizeBytes";
ALTER INDEX "Content_h264ObjectKey_key" RENAME TO "Content_originalObjectKey_key";
