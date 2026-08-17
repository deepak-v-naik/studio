-- GPS-verified onboarding photos: shop-front photo gates the Team-verification
-- stage, installed-TV photo gates Site-visit-&-install and beyond.
ALTER TABLE "Store"
  ADD COLUMN "shopPhotoUrl" TEXT,
  ADD COLUMN "shopPhotoLat" DOUBLE PRECISION,
  ADD COLUMN "shopPhotoLng" DOUBLE PRECISION,
  ADD COLUMN "shopPhotoSource" TEXT,
  ADD COLUMN "shopPhotoAt" TIMESTAMP(3),
  ADD COLUMN "installPhotoUrl" TEXT,
  ADD COLUMN "installPhotoLat" DOUBLE PRECISION,
  ADD COLUMN "installPhotoLng" DOUBLE PRECISION,
  ADD COLUMN "installPhotoSource" TEXT,
  ADD COLUMN "installPhotoAt" TIMESTAMP(3);
