// POST /api/razorpay/create-order
// Creates a Razorpay order for a brand campaign. The charge amount is
// RECOMPUTED server-side from { screens, months, couponCode } — the client's
// own total is never trusted, so it can't be tampered with in the browser.
//
// Body:
//   screens    number   (required)
//   months     number   (required)
//   couponCode string?  (validated against the DB; ignored if invalid)
//   applyGst   boolean  (whether this flow adds 18% GST — preserves each
//                        flow's existing behaviour; onboarding/renewal = true,
//                        pay-later pending campaign = false)
//   trial      boolean? (free first campaign — server-gated, see below)
//   email      string?  (required when trial=true, for eligibility)
//   receipt    string?
//   notes      object?

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaignTotal } from '@/lib/brand-pricing';
import { resolveCoupon } from '@/lib/coupons';

export async function POST(req: NextRequest) {
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return NextResponse.json(
      { error: 'Razorpay credentials are not configured on the server.' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json() as {
      screens?: number; months?: number; couponCode?: string;
      applyGst?: boolean; trial?: boolean; email?: string;
      receipt?: string; notes?: Record<string, unknown>;
    };

    const screens = Math.floor(Number(body.screens));
    const months  = Math.floor(Number(body.months));
    if (!Number.isFinite(screens) || screens < 1 || screens > 50 || !Number.isFinite(months) || months < 1 || months > 12) {
      return NextResponse.json({ error: 'Invalid order: screens must be 1–50 and months 1–12.' }, { status: 400 });
    }

    // ── Recompute the authoritative amount (rupees) ────────────────────────────
    let amountRupees: number;

    if (body.trial) {
      // C1: a free (₹0) campaign is allowed only once per brand — gated by email
      // having no prior campaign. Prevents anyone forcing ₹0 via ?trial=1.
      const email = (body.email ?? '').trim().toLowerCase();
      if (!email) {
        return NextResponse.json({ error: 'Email is required for a free trial.' }, { status: 400 });
      }
      const priorCampaigns = await db.campaign.count({ where: { email } });
      if (priorCampaigns > 0) {
        return NextResponse.json({ error: 'A free trial has already been used for this account.' }, { status: 403 });
      }
      amountRupees = 0;
    } else {
      // Server-validate the coupon and recompute the discount — the browser's
      // claimed discount is never trusted.
      let discount = 0;
      if (body.couponCode) {
        const base = campaignTotal({ screens, months, applyGst: false });
        const res  = await resolveCoupon(body.couponCode, base);
        if (res.valid) discount = res.discount;
      }
      amountRupees = campaignTotal({ screens, months, discount, applyGst: body.applyGst !== false });
    }

    // Razorpay requires note values to be strings
    const safeNotes: Record<string, string> = {};
    if (body.notes && typeof body.notes === 'object') {
      for (const [k, v] of Object.entries(body.notes)) safeNotes[k] = String(v);
    }

    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount:   Math.round(amountRupees * 100), // INR → paise
        currency: 'INR',
        receipt:  body.receipt ?? `alive_${Date.now()}`,
        notes:    safeNotes,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = (data as { error?: { description?: string } }).error?.description
        ?? 'Razorpay order creation failed';
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? 'Internal server error' },
      { status: 500 },
    );
  }
}
