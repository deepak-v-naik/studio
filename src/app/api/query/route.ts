import { NextRequest, NextResponse } from 'next/server';
import { QUERY_SCHEMA, runQueryDsl } from '@/lib/query-router';

// Exposes campaign/bill/store aggregates — admin only.
function adminGuard(req: NextRequest) {
  const pw = req.headers.get('admin-password') ?? '';
  return !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ schema: QUERY_SCHEMA });
}

export async function POST(req: NextRequest) {
  if (!adminGuard(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const query = await req.json();
    const result = await runQueryDsl(query);
    return NextResponse.json({ schema: QUERY_SCHEMA, result });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message, schema: QUERY_SCHEMA },
      { status: 400 },
    );
  }
}
