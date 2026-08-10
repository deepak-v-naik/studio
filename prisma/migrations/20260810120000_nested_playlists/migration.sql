-- Nested playlists (SMIL Master → Internal): a PlaylistItem now points at EITHER a
-- Content row (media item, as before) OR another Playlist (nested item).
ALTER TABLE "PlaylistItem" ALTER COLUMN "contentId" DROP NOT NULL;
ALTER TABLE "PlaylistItem" ADD COLUMN "childPlaylistId" TEXT;
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_childPlaylistId_fkey"
  FOREIGN KEY ("childPlaylistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PlaylistItem_childPlaylistId_idx" ON "PlaylistItem"("childPlaylistId");
