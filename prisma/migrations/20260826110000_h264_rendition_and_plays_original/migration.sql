-- Safe H.264 rendition columns on Content: objectKey keeps the ORIGINAL upload, the
-- transcode callback now writes the rendition here instead of overwriting in place.
ALTER TABLE "Content" ADD COLUMN "h264ObjectKey" TEXT;
ALTER TABLE "Content" ADD COLUMN "h264Md5" TEXT;
ALTER TABLE "Content" ADD COLUMN "h264SizeBytes" BIGINT;

CREATE UNIQUE INDEX "Content_h264ObjectKey_key" ON "Content"("h264ObjectKey");

-- Per-device rendition selection: capable panels play originals, budget SoCs get the
-- safe rendition (default).
ALTER TABLE "Device" ADD COLUMN "playsOriginal" BOOLEAN NOT NULL DEFAULT false;
