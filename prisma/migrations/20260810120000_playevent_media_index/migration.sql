-- Proof-of-Play "By Ad video" reports filter/aggregate PlayEvent by mediaId over a
-- date range. mediaId was previously unindexed, forcing a full table scan. This
-- composite matches the (mediaId, startedAt) access pattern used by /api/reports/plays.
CREATE INDEX "PlayEvent_mediaId_startedAt_idx" ON "PlayEvent"("mediaId", "startedAt");
