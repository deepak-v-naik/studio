// Single source of truth for brand campaign pricing. Used by the client
// (brand-onboarding + brand dashboard) for display AND by the server
// (/api/razorpay/create-order) to recompute the authoritative charge amount,
// so the price can't be tampered with in the browser.
//
// All amounts here are in RUPEES (the Razorpay order route converts to paise).

export const GST_RATE = 0.18;

// Per-screen monthly pricing, tiered by volume. Two columns per tier:
//   list   — anchor price shown struck through (benchmarked against comparable
//            Indian captive-audience screens, Aug 2026 pricing research)
//   online — what self-serve bookings are actually charged
// Both flow through this module only — the onboarding and dashboard UIs import
// from here, no local price tables. Coupons stack on top of the online price.
export const PRICE_TIERS = [
  { minScreens: 20, list: 999,  online: 699 },
  { minScreens: 10, list: 1099, online: 799 },
  { minScreens: 3,  list: 1199, online: 899 },
  { minScreens: 1,  list: 1299, online: 999 },
] as const;

/** Charged (online) per-screen monthly price for a given screen count. */
export function getScreenPrice(screens: number): number {
  const s = Math.max(1, Math.floor(screens || 1));
  for (const t of PRICE_TIERS) if (s >= t.minScreens) return t.online;
  return PRICE_TIERS[PRICE_TIERS.length - 1].online;
}

/** Anchor (list) per-screen monthly price for a given screen count. */
export function getListPrice(screens: number): number {
  const s = Math.max(1, Math.floor(screens || 1));
  for (const t of PRICE_TIERS) if (s >= t.minScreens) return t.list;
  return PRICE_TIERS[PRICE_TIERS.length - 1].list;
}

/** Base campaign cost before discounts/GST, in rupees. */
export function campaignBase(screens: number, months: number): number {
  const s = Math.max(1, Math.floor(screens || 1));
  const m = Math.max(1, Math.floor(months  || 1));
  return getScreenPrice(s) * s * m;
}

export function gstOn(net: number): number {
  return Math.round(net * GST_RATE);
}

/**
 * Final charge in rupees for a campaign.
 * @param applyGst  whether this flow adds 18% GST (preserves each flow's existing behaviour)
 */
export function campaignTotal(opts: {
  screens: number;
  months: number;
  discount?: number;   // rupees off, already validated server-side
  applyGst: boolean;
}): number {
  const base = campaignBase(opts.screens, opts.months);
  const net  = Math.max(0, base - Math.max(0, Math.floor(opts.discount ?? 0)));
  return opts.applyGst ? net + gstOn(net) : net;
}
