-- Grandfather the existing fleet before pairedAt becomes an authorization gate.
--
-- /api/device/plan and /api/device/events are about to reject devices whose
-- pairedAt is null, so that an unpaired self-enrolled device cannot read plans
-- or write billable proof-of-play. Devices already in the field predate that
-- rule: some were claimed and put to work before the admin pairing step
-- existed, and rejecting them would blank real screens in real shops the moment
-- this deploys.
--
-- Any device that has ever sent a heartbeat is, by definition, one we already
-- served — trusting it is a statement of the status quo, not a new grant. It is
-- backdated to claimedAt rather than now() so the audit trail stays honest
-- about when the device actually entered the fleet.
--
-- Devices that have never been seen (PENDING rows, abandoned claims) are
-- deliberately NOT backfilled: they must go through admin pairing like any new
-- screen.
UPDATE "Device"
SET "pairedAt" = "claimedAt"
WHERE "pairedAt" IS NULL
  AND "lastSeen" IS NOT NULL;
