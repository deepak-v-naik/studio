import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';

type Body = {
  razorpay_order_id:   string;
  razorpay_payment_id: string;
  razorpay_signature:  string;
  // Optional campaign payload — when present, campaign is upserted as 'active'
  campaign?: {
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
    couponCode?:    string;
  };
};

export async function POST(req: NextRequest) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, campaign } =
      await req.json() as Body;

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return NextResponse.json({ success: false, error: 'Signature mismatch' }, { status: 400 });
    }

    // Upsert campaign — find by orderId if it already exists (pay-later flow), else create
    if (campaign) {
      // The client's totalAmount is display-only and never stored. The amount
      // actually charged lives on the Razorpay order (created server-side by
      // create-order), so fetch it back as the authoritative figure.
      const credentials = Buffer.from(
        `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
      ).toString('base64');
      const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
        headers: { Authorization: `Basic ${credentials}` },
      });
      if (!orderRes.ok) {
        return NextResponse.json({ success: false, error: 'Could not confirm the order amount. Please contact hello@wearealive.in.' }, { status: 502 });
      }
      const order = await orderRes.json() as { amount?: number };
      const chargedRupees = Math.round(Number(order.amount ?? 0) / 100);

      const brand = await db.brand.findFirst({ where: { email: campaign.email } });

      const existing = await db.campaign.findFirst({ where: { orderId: razorpay_order_id } });

      if (existing) {
        await db.campaign.update({
          where: { id: existing.id },
          data:  { paymentId: razorpay_payment_id, status: 'active', totalAmount: chargedRupees },
        });
      } else {
        await db.campaign.create({
          data: {
            brandId:        brand?.id ?? null,
            name:           `${campaign.brandName} — ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`,
            contactName:    campaign.contactName,
            email:          campaign.email,
            phone:          campaign.phone ?? undefined,
            screens:        campaign.screens    ?? 1,
            months:         campaign.months     ?? 1,
            startDate:      new Date(campaign.startDate),
            pricePerScreen: campaign.pricePerScreen,
            totalAmount:    chargedRupees,
            couponCode:     campaign.couponCode ?? null,
            paymentId:      razorpay_payment_id,
            orderId:        razorpay_order_id,
            status:         'active',
          },
        });

        // Count the redemption against the coupon's usage cap (best-effort).
        if (campaign.couponCode) {
          await db.coupon.updateMany({
            where: { code: campaign.couponCode.toUpperCase() },
            data:  { redemptions: { increment: 1 } },
          }).catch(() => {});
        }
      }
    }

    return NextResponse.json({ success: true, payment_id: razorpay_payment_id });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
