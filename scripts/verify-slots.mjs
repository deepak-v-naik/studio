// Verifies the slot-loop rules from the spec against src/lib/slots.ts.
// Pure math only (no DB) — run with:  node --experimental-strip-types scripts/verify-slots.mjs
// Kept as a script rather than a test-runner suite because this repo has no test runner
// configured; it exits non-zero on failure so CI can call it directly.

import { buildSlotLoop, loopRepeatsPerDay, isOpenOn, istWeekday } from '../src/lib/slots.ts';

let failures = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
};

const c = (id, content) => ({ campaignId: id, slotContentId: content });
const booking = (pos, id, content = `${id}-creative`) => ({ slotPosition: pos, ...c(id, content) });
const FILLER = { campaignId: 'house', contentId: 'house-creative' };
const shape = (loop) => loop.map((a) => `${a.slotPosition}:${a.campaignId}${a.isFiller ? '*' : ''}`);

console.log('buildSlotLoop — spec rules 3/4 (no dark slots)');

// Rule 3: zero sales → whole loop is house filler.
eq('zero sales → all filler',
  shape(buildSlotLoop(6, [], FILLER)),
  ['0:house*','1:house*','2:house*','3:house*','4:house*','5:house*']);

// Rule 4: empties round-robin across sold campaigns as bonus plays, never house ads.
eq('one sale → bonus plays fill the rest (house never used)',
  shape(buildSlotLoop(4, [booking(0, 'A')], FILLER)),
  ['0:A','1:A*','2:A*','3:A*']);

eq('two sales → empties alternate between them',
  shape(buildSlotLoop(6, [booking(0, 'A'), booking(1, 'B')], FILLER)),
  ['0:A','1:B','2:A*','3:B*','4:A*','5:B*']);

eq('sold-out loop → no filler entries at all',
  shape(buildSlotLoop(3, [booking(0,'A'), booking(1,'B'), booking(2,'C')], FILLER)),
  ['0:A','1:B','2:C']);

eq('non-contiguous bookings keep their exact positions',
  shape(buildSlotLoop(5, [booking(3, 'A')], FILLER)),
  ['0:A*','1:A*','2:A*','3:A','4:A*']);

// A booked campaign with no 10s creative is still SOLD (availability) but cannot render,
// so its position must not go dark — it falls through to redistribution.
eq('sold campaign without creative → position redistributed, not dark',
  shape(buildSlotLoop(4, [booking(0, 'A'), { slotPosition: 1, campaignId: 'B', slotContentId: null }], FILLER)),
  ['0:A','1:A*','2:A*','3:A*']);

eq('only unplayable sales → house filler carries the loop',
  shape(buildSlotLoop(3, [{ slotPosition: 0, campaignId: 'B', slotContentId: null }], FILLER)),
  ['0:house*','1:house*','2:house*']);

// Nothing playable anywhere: positions are omitted rather than emitting broken items.
eq('no sales and no filler → empty loop', buildSlotLoop(4, [], null), []);

eq('out-of-range booking positions are ignored',
  shape(buildSlotLoop(2, [booking(0,'A'), booking(9,'Z')], FILLER)),
  ['0:A','1:A*']);

console.log('loopRepeatsPerDay — brand "guaranteed" math');
// 09:00–21:00 = 12h = 43200s; 6 slots × 10s = 60s per loop → 720 loops/day.
eq('6 slots, 9am–9pm → 720', loopRepeatsPerDay({ loopSlotCount: 6, hoursStart: '09:00', hoursEnd: '21:00' }), 720);
eq('8 slots, 9am–9pm → 540', loopRepeatsPerDay({ loopSlotCount: 8, hoursStart: '09:00', hoursEnd: '21:00' }), 540);
eq('closed window → 0',      loopRepeatsPerDay({ loopSlotCount: 6, hoursStart: '10:00', hoursEnd: '10:00' }), 0);

console.log('open_days exclusion');
// 2026-08-10 is a Monday → bit 0.
eq('weekday index (Mon)', istWeekday('2026-08-10'), 0);
eq('weekday index (Sun)', istWeekday('2026-08-16'), 6);
eq('all days open',       isOpenOn(127, '2026-08-16'), true);
eq('Sunday closed',       isOpenOn(0b0111111, '2026-08-16'), false);
eq('Mon–Fri open on Mon', isOpenOn(0b0011111, '2026-08-10'), true);

// Loop-shrink compaction: mirrors planSlotCompaction's per-date packing (that function
// is DB-bound, so the packing rule itself is exercised here on the same inputs).
function packDate(rows, newCount) {
  const stranded = rows.filter((r) => r.slotPosition >= newCount);
  if (!stranded.length) return { ok: true, moves: [] };
  const taken = new Set(rows.filter((r) => r.slotPosition < newCount).map((r) => r.slotPosition));
  const free = [];
  for (let p = 0; p < newCount && free.length < stranded.length; p++) if (!taken.has(p)) free.push(p);
  if (free.length < stranded.length) return { ok: false, stranded: stranded.length, free: free.length };
  return { ok: true, moves: stranded.map((s, i) => `${s.slotPosition}→${free[i]}`) };
}
const at = (...positions) => positions.map((p) => ({ slotPosition: p }));

console.log('loop shrink — auto-reassign where there is room');

// 15 → 8 with sales spread past the new limit: the high slots pack into the free lows.
eq('15→8 packs stranded bookings into free low slots',
  packDate(at(0, 3, 9, 12), 8), { ok: true, moves: ['9→1', '12→2'] });

eq('nothing above the new count → no moves',
  packDate(at(0, 1, 2), 8), { ok: true, moves: [] });

eq('growing the loop never moves anything',
  packDate(at(0, 5, 7), 15), { ok: true, moves: [] });

// Exactly full is still fine — every stranded booking finds a hole.
eq('exactly enough room → all packed',
  packDate(at(0, 1, 9, 10), 4), { ok: true, moves: ['9→2', '10→3'] });

// Real oversell: more sold slots than the new loop can hold. Must block, not silently drop.
eq('more bookings than the new loop holds → blocked',
  packDate(at(0, 1, 2, 9), 3), { ok: false, stranded: 1, free: 0 });

// Leaving slot mode entirely (count 0) has nowhere to put a sold slot.
eq('turning slot mode off with sold slots → blocked',
  packDate(at(0), 0), { ok: false, stranded: 1, free: 0 });

console.log(failures === 0 ? '\nAll slot rules verified.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
