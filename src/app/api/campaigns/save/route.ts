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
    };

    if (!body.email || !body.brandName) {
      const envelope = await respond({ error: 'brandName and email required' }, { route, request: { hasEmail: !!body.email, hasBrandName: !!body.brandName }, outcome: 'invalid_request', policyFlags: ['missing_required_fields'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope, { status: 400 });
    }

    // This route is unauthenticated — never let the client mint an 'active'
    // (i.e. paid-looking) campaign. Paid status is set only by verify-payment
    // after the Razorpay signature check.
    if (body.status && !['upcoming', 'pending_payment'].includes(body.status)) {
      const envelope = await respond({ error: 'Invalid campaign status.' }, { route, request: { status: body.status }, outcome: 'invalid_request', policyFlags: ['invalid_status'], errorCategory: 'validation', startedAtMs });
      return NextResponse.json(envelope, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();

    // C1: a free (₹0) campaign — the "free trial" path — is allowed only once
    // per brand. Without this, anyone could repeatedly create ₹0 campaigns via
    // the ?trial=1 link. Paid bookings (totalAmount > 0) are unaffected.
    if (Number(body.totalAmount) <= 0) {
      const priorFreeTrials = await db.campaign.count({
        where: { email, totalAmount: { lte: 0 } },
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
        screens:        body.screens    ?? 1,
        months:         body.months     ?? 1,
        startDate:      new Date(body.startDate),
        pricePerScreen: body.pricePerScreen,
        totalAmount:    body.totalAmount,
        paymentId:      body.paymentId  ?? null,
        orderId:        body.orderId    ?? null,
        status:         body.status     ?? 'upcoming',
      },
    });

    const envelope = await respond({ success: true, id: campaign.id }, { route, request: { email: body.email, brandName: body.brandName }, outcome: 'success', startedAtMs });
    return NextResponse.json(envelope);
  } catch (e) {
    const envelope = await respond({ error: (e as Error).message ?? 'Failed to save campaign' }, { route, request: { operation: 'create_campaign' }, outcome: 'server_error', policyFlags: ['exception'], errorCategory: 'runtime', startedAtMs });
    return NextResponse.json(envelope, { status: 500 });
  }
}
