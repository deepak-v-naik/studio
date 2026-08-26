#!/usr/bin/env node
// Directly invokes the alive-transcode Lambda for pending/errored videos — same payload
// as src/lib/transcode-lambda.ts triggerTranscode(), bypassing the admin API. Used to
// re-drive transcodes after the ffprobe-EACCES Lambda fix without needing ADMIN_PASSWORD.
// Requires TRANSCODE_* + DATABASE_URL in studio/.env (see that file's transcode block).
//
// Usage: node invoke-transcode.mjs [--public-base <url>] [contentId ...]
//        (no ids = every VIDEO row with transcodeStatus != 'done')

import 'dotenv/config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--public-base');
const PUBLIC_BASE = (baseIdx >= 0 ? args[baseIdx + 1] : 'https://pub-7a9bd7006a434f6c84ea68e69b323918.r2.dev').replace(/\/+$/, '');
const ids = args.filter((a, i) => !a.startsWith('--') && i !== baseIdx + 1);

for (const k of ['TRANSCODE_LAMBDA_FUNCTION_NAME', 'TRANSCODE_LAMBDA_REGION', 'TRANSCODE_AWS_ACCESS_KEY_ID', 'TRANSCODE_AWS_SECRET_ACCESS_KEY']) {
  if (!process.env[k] || process.env[k] === '[SENSITIVE]') { console.error(`✗ ${k} missing`); process.exit(1); }
}

const client = new LambdaClient({
  region: process.env.TRANSCODE_LAMBDA_REGION,
  credentials: {
    accessKeyId: process.env.TRANSCODE_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.TRANSCODE_AWS_SECRET_ACCESS_KEY,
  },
});

// NULL-inclusive on purpose: SQL three-valued logic makes `NOT = 'done'` skip NULL
// rows, and NULL is a real state (upload succeeded but the browser's best-effort
// transcode trigger never fired) — exactly the rows a backfill must not miss.
const targets = ids.length
  ? await db.content.findMany({ where: { id: { in: ids } } })
  : await db.content.findMany({ where: { type: 'VIDEO', OR: [{ transcodeStatus: null }, { NOT: { transcodeStatus: 'done' } }] } });

if (!targets.length) { console.log('No pending videos.'); process.exit(0); }

for (const c of targets) {
  // Transcode from the preserved original when there is one — re-encoding the
  // rendition would stack generation loss.
  const inputUrl = `${PUBLIC_BASE}/${c.originalObjectKey ?? c.objectKey}`;
  // Verify the source is fetchable before firing — a bad URL would just burn a Lambda run.
  const head = await fetch(inputUrl, { method: 'HEAD' });
  if (!head.ok) { console.error(`✗ ${c.name}: source not fetchable (HTTP ${head.status}) ${inputUrl}`); continue; }
  await db.content.update({ where: { id: c.id }, data: { transcodeStatus: 'pending', transcodeError: null } });
  await client.send(new InvokeCommand({
    FunctionName: process.env.TRANSCODE_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({ contentId: c.id, inputUrl })),
  }));
  console.log(`▶ fired: ${c.name} (${c.id}) ← ${inputUrl}`);
}
console.log(`\n${targets.length} invocation(s) sent. The Lambda calls back the studio to flip rows to done/error.`);
await db.$disconnect();
