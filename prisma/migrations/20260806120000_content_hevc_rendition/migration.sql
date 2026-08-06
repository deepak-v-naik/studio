ALTER TABLE "Content" ADD COLUMN "hevcObjectKey" TEXT;
ALTER TABLE "Content" ADD COLUMN "hevcMd5" TEXT;
ALTER TABLE "Content" ADD COLUMN "hevcSizeBytes" BIGINT;
CREATE UNIQUE INDEX "Content_hevcObjectKey_key" ON "Content"("hevcObjectKey");
