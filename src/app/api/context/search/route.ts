import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cosineSimilarity, embedText } from '@/lib/context-engine/indexer';

export async function POST(req: NextRequest) {
  // Context documents can contain internal operational data — admin only.
  const pw = req.headers.get('admin-password') ?? '';
  if (process.env.ADMIN_PASSWORD && pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const limit = typeof body?.limit === 'number' ? Math.min(Math.max(body.limit, 1), 25) : 10;

  if (!query) {
    return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  }

  const queryEmbedding = embedText(query);
  const docs = await db.contextDocument.findMany({
    take: 200,
    orderBy: { timestamp: 'desc' },
  });

  const results = docs
    .map((doc) => ({
      ...doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return NextResponse.json({ ok: true, results });
}
