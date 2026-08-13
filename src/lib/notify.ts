// Notification helper — WhatsApp via Twilio (graceful no-op if env vars missing)
// Also supports simple email via Resend if RESEND_API_KEY is set.

const ADMIN_WA = process.env.ADMIN_WHATSAPP ?? '+917411324448'; // VS Collective LLP

async function sendTwilioWhatsApp(to: string, body: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886';
  if (!sid || !token) return;

  const toWa = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const creds = Buffer.from(`${sid}:${token}`).toString('base64');

  await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ To: toWa, From: from, Body: body }).toString(),
  });
}

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'ALIVE <hello@wearealive.in>', to: [to], subject, html }),
  });
}

// ─── Public helpers ──────────────────────────────────────────────────────────

export async function notifyAdminWA(message: string): Promise<void> {
  try { await sendTwilioWhatsApp(ADMIN_WA, message); } catch { /* non-fatal */ }
}

export async function notifyAdminEmail(subject: string, html: string): Promise<void> {
  try { await sendResendEmail('hello@wearealive.in', subject, html); } catch { /* non-fatal */ }
}

export async function notifyStoreWA(phone: string, message: string): Promise<void> {
  // phone: 10-digit or +91XXXXXXXXXX
  const e164 = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '').slice(-10)}`;
  try { await sendTwilioWhatsApp(e164, message); } catch { /* non-fatal */ }
}

// ─── Canned messages ─────────────────────────────────────────────────────────

export function storeRegistrationMsg(store: {
  storeName: string; ownerName: string; phone: string;
  city?: string | null; address?: string | null; gstin?: string | null;
}) {
  return [
    `🏪 *New Store Registration*`,
    `Store: ${store.storeName}`,
    `Owner: ${store.ownerName}`,
    `Phone: ${store.phone}`,
    store.city    ? `City: ${store.city}` : null,
    store.address ? `Address: ${store.address}` : null,
    store.gstin   ? `GSTIN: ${store.gstin}` : null,
    ``,
    `Go to admin: https://wearealive.in/admin`,
  ].filter(Boolean).join('\n');
}

export function payoutClaimMsg(store: {
  storeName: string; ownerName: string; phone: string; month: string;
}) {
  return [
    `💰 *Payout Claim Received*`,
    `Store: ${store.storeName}`,
    `Owner: ${store.ownerName}`,
    `Phone: ${store.phone}`,
    `Month: ${store.month}`,
    `Amount: ₹500 + electricity`,
  ].join('\n');
}

export function billClaimedMsg(storeName: string, customerName: string, customerPhone: string, billRef: string) {
  return [
    `🧾 *Bill Claimed*`,
    `Bill: ${billRef}`,
    `Store: ${storeName}`,
    `Customer: ${customerName} (${customerPhone})`,
    `View: https://wearealive.in/bill/${billRef}`,
  ].join('\n');
}
