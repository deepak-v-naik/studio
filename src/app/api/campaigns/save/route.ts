import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { respond } from '@/lib/api-envelope';

export async function POST(req: NextRequest) {
  const route = '/api/campaigns/save';
  const startedAtMs = Date.now();
  try {
    const body = await req.json() as {
      brandName:      string;
      contactName:    string;
      email:          string;
      phone:          string;
      gstin?:         string;
      screens:        number;
      months:         number;
      startDate:      string;
      pricePerScreen: number;
      totalAmount:    number;
      paymentId?:     string;
      orderId?:       string;
      status?:        string;
      preferredStoreIds?: unknown; // store ids picked on the onboarding map
    };

    if (!body.email || !body.brandName) {
      const envelope = await respond({ error: 'brandName and email required' }, { route, request: { hasEmail: !!body.email, hasBrandName: !!body.brandName }, outcome: 'invalid_request', policyFlags: ['missing_required_fields'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope, { status: 400 });
    }

    // This route is unauthenticated — never let the client mint an 'active'
    // (i.e. paid-looking) campaign. Paid status is set only by verify-payment
    // after the Razorpay signature check.
    if (body.status && !['upcoming', 'pending_payment', 'trial'].includes(body.status)) {
      const envelope = await respond({ error: 'Invalid campaign status.' }, { route, request: { status: body.status }, outcome: 'invalid_request', policyFlags: ['invalid_status'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope, { status: 400 });
    }

    const screens = Math.floor(Number(body.screens ?? 1));
    const months  = Math.floor(Number(body.months  ?? 1));
    if (!Number.isFinite(screens) || screens < 1 || screens > 50 || !Number.isFinite(months) || months < 1 || months > 12) {
      const envelope = await respond({ error: 'Invalid booking: screens must be 1–50 and months 1–12.' }, { route, request: { screens: body.screens, months: body.months }, outcome: 'invalid_request', policyFlags: ['invalid_bounds'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();

    // Map-picked store ids — a routing hint for ops, not a reservation. Sanitised
    // hard because the route is unauthenticated: strings only, cuid-shaped, capped
    // at the screen ceiling. Unknown ids are tolerated (ops sees names resolved
    // from the DB; anything unresolvable simply doesn't render).
    // Truncate BEFORE per-element work so an oversized hostile array costs nothing.
    const preferredStoreIds = Array.isArray(body.preferredStoreIds)
      ? body.preferredStoreIds
          .slice(0, 200)
          .filter((v): v is string => typeof v === 'string' && /^[a-z0-9]{20,32}$/.test(v))
          .slice(0, 50)
      : [];

    // A ₹0 booking IS a trial regardless of what the client claims, and a
    // claimed trial is always ₹0 — normalising here keeps the two in lockstep
    // so reporting can filter on status alone.
    const isTrial = Number(body.totalAmount) <= 0 || body.status === 'trial';
    const status  = isTrial ? 'trial' : (body.status ?? 'upcoming');

    // C1: a free trial is allowed only once per brand. Without this, anyone
    // could repeatedly create ₹0 campaigns via the ?trial=1 link. The
    // totalAmount leg covers legacy trial rows saved as pending_payment ₹0.
    if (isTrial) {
      const priorFreeTrials = await db.campaign.count({
        where: { email, OR: [{ status: 'trial' }, { totalAmount: { lte: 0 } }] },
      });
      if (priorFreeTrials > 0) {
        const envelope = await respond({ error: 'A free trial has already been used for this account.' }, { route, request: { email }, outcome: 'invalid_request', policyFlags: ['trial_already_used'], errorCategory: 'validation', startedAtMs });
        return NextResponse.json(envelope, { status: 403 });
      }
    }

    // Look up brand by email — optional link
    const brand = await db.brand.findFirst({ where: { email: body.email } });

    const campaign = await db.campaign.create({
      data: {
        brandId:        brand?.id ?? null,
        name:           `${body.brandName} — ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`,
        contactName:    body.contactName,
        email:          body.email,
        phone:          body.phone ?? undefined,
        screens,
        months,
        startDate:      new Date(body.startDate),
        pricePerScreen: body.pricePerScreen,
        totalAmount:    isTrial ? 0 : body.totalAmount,
        paymentId:      body.paymentId  ?? null,
        orderId:        body.orderId    ?? null,
        status,
        preferredStoreIds,
      },
    });

    const envelope = await respond({ success: true, id: campaign.id }, { route, request: { email: body.email, brandName: body.brandName }, outcome: 'success', startedAtMs });
    return NextResponse.json(envelope);
  } catch (e) {
    const envelope = await respond({ error: (e as Error).message ?? 'Failed to save campaign' }, { route, request: { operation: 'create_campaign' }, outcome: 'server_error', policyFlags: ['exception'], errorCategory: 'runtime', startedAtMs });
    return NextResponse.json(envelope, { status: 500 });
  }
}
