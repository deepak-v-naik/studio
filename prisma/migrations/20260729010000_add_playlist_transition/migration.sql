-- CreateEnum
CREATE TYPE "PlaylistTransition" AS ENUM ('NONE', 'FADE', 'SLIDE');

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN "transition" "PlaylistTransition" NOT NULL DEFAULT 'NONE';
