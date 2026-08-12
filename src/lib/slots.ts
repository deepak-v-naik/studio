// Slot-loop inventory core (see prisma SlotBooking block for the model).
//
// Semantics locked by the spec:
// - Availability(store, date) = loopSlotCount − COUNT(bookings) — SOLD bookings only.
//   Filler/bonus fill state must never surface as "sold out" to brands.
// - Playback never has dark slots: zero sales → whole loop plays the filler (house
//   ads) campaign; otherwise empty positions are round-robined across the sold
//   campaigns as bonus plays (isFiller=true, attributed to the campaign).
// - All dates are IST calendar dates; a store's open days are a Mon..Sun bitmask.

export const SLOT_DURATION_MS = 10_000;

const IST_OFFSET_MS = 330 * 60 * 1000; // +05:30, no DST

/** Today's IST calendar date as 'YYYY-MM-DD'. */
export function istToday(now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST weekday for a 'YYYY-MM-DD' date: 0=Mon … 6=Sun (matches the openDays bitmask). */
export function istWeekday(dateStr: string): number {
  const jsDay = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  return (jsDay + 6) % 7;
}

export function isOpenOn(openDays: number, dateStr: string): boolean {
  return (openDays & (1 << istWeekday(dateStr))) !== 0;
}

/** 'HH:mm' → minutes since midnight; null on malformed input. */
export function parseHHmm(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** How many times the full loop repeats across one open day (brand "guaranteed" math). */
export function loopRepeatsPerDay(store: {
  loopSlotCount: number; hoursStart: string; hoursEnd: string;
}): number {
  const start = parseHHmm(store.hoursStart) ?? 9 * 60;
  const end   = parseHHmm(store.hoursEnd)   ?? 21 * 60;
  const openSec = Math.max(0, end - start) * 60;
  const loopSec = store.loopSlotCount * (SLOT_DURATION_MS / 1000);
  return loopSec > 0 ? Math.floor(openSec / loopSec) : 0;
}

// ── Loop assembly ─────────────────────────────────────────────────────────────

export type SlotAssignment = {
  slotPosition: number;
  campaignId:   string;
  contentId:    string;      // the campaign's slot creative
  isFiller:     boolean;     // true = bonus/house play in an unsold (or unplayable) position
};

type BookingRow = { slotPosition: number; campaignId: string; slotContentId: string | null };

/**
 * Builds the playable loop for one store+date. Returns one assignment per position
 * that CAN play; positions with nothing playable anywhere (no sold creatives and no
 * filler creative) are omitted — the caller decides what an empty loop means.
 *
 * A booked campaign without a slot creative counts as SOLD for availability but
 * cannot render, so its positions join the redistribution set rather than going dark.
 */
export function buildSlotLoop(
  loopSlotCount: number,
  bookings: BookingRow[],
  filler: { campaignId: string; contentId: string } | null,
): SlotAssignment[] {
  const byPosition = new Map<number, BookingRow>();
  for (const b of bookings) {
    if (b.slotPosition >= 0 && b.slotPosition < loopSlotCount) byPosition.set(b.slotPosition, b);
  }

  // Playable sold campaigns in first-appearance (position) order — the round-robin pool.
  const pool: { campaignId: string; contentId: string }[] = [];
  const seen = new Set<string>();
  for (let pos = 0; pos < loopSlotCount; pos++) {
    const b = byPosition.get(pos);
    if (b?.slotContentId && !seen.has(b.campaignId)) {
      seen.add(b.campaignId);
      pool.push({ campaignId: b.campaignId, contentId: b.slotContentId });
    }
  }

  const out: SlotAssignment[] = [];
  let rr = 0;
  for (let pos = 0; pos < loopSlotCount; pos++) {
    const b = byPosition.get(pos);
    if (b?.slotContentId) {
      out.push({ slotPosition: pos, campaignId: b.campaignId, contentId: b.slotContentId, isFiller: false });
    } else if (pool.length > 0) {
      const p = pool[rr++ % pool.length]; // bonus play for a sold campaign
      out.push({ slotPosition: pos, campaignId: p.campaignId, contentId: p.contentId, isFiller: true });
    } else if (filler) {
      out.push({ slotPosition: pos, campaignId: filler.campaignId, contentId: filler.contentId, isFiller: true });
    }
    // else: nothing playable exists — position omitted
  }
  return out;
}
