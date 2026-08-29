import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { collectAllContextSources } from '@/lib/context-engine/collectors';
import { embedText, upsertContextDocuments } from '@/lib/context-engine/indexer';
import { normalizeContextRecord } from '@/lib/context-engine/normalizers';
import { isCronAuthorized } from '@/lib/cron-auth';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!isCronAuthorized(auth)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const state = await db.contextSyncState.upsert({
    where: { key: 'default' },
    update: {},
    create: { key: 'default', watermark: new Date(0) },
  });

  const records = await collectAllContextSources(state.watermark);
  const documents = records.map((record) =>
    normalizeContextRecord(record, embedText(`${record.summary}\n${record.rawRef}`)),
  );

  await upsertContextDocuments(documents);

  const latestTimestamp =
    records.length > 0
      ? new Date(Math.max(...records.map((record) => record.timestamp.getTime())))
      : state.watermark;

  await db.contextSyncState.update({
    where: { key: 'default' },
    data: { watermark: latestTimestamp },
  });

  return NextResponse.json({ ok: true, ingested: documents.length, watermark: latestTimestamp.toISOString() });
}
