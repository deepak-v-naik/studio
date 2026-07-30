// Client-side error sink.
//
// POST /api/telemetry
//
// error-boundary.tsx and app/error.tsx have always posted here, but the route did not
// exist — so every client-side crash 404'd instead of being recorded. That is why a
// browser-side failure (a ChunkLoadError bricking the admin panel) left no trace
// anywhere server-side and had to be diagnosed from a pasted console log.
//
// Unauthenticated by design: it is called from an error path, where a session may be
// exactly what is broken. Fields are therefore treated as untrusted and clamped before
// being stored.

import { NextRequest, NextResponse } from 'next/server';
import { recordError, getOrCreateCorrelationId } from '@/lib/telemetry';

type Body = {
  errorClass?: string;
  message?:    string;
  source?:     string;
  route?:      string;
  stack?:      string;
};

const clamp = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Body;

    await recordError({
      // Honour an inbound correlation id so a client crash can be tied to the server
      // request that preceded it.
      correlationId: getOrCreateCorrelationId(req.headers.get('x-correlation-id')),
      route:       clamp(body.route, 200) ?? '/client',
      errorClass:  clamp(body.errorClass, 120) ?? 'ClientError',
      message:     clamp(body.message, 1000) ?? 'unknown client error',
      actorType:   'user',
      requestMeta: {
        source:    clamp(body.source, 80) ?? 'client',
        userAgent: clamp(req.headers.get('user-agent'), 300),
        referer:   clamp(req.headers.get('referer'), 300),
      },
    });

    // 204 keeps the client's fire-and-forget fetch cheap; it never reads a body.
    return new NextResponse(null, { status: 204 });
  } catch {
    // Never surface an error from the error reporter — that just compounds the failure
    // the client is already in.
    return new NextResponse(null, { status: 204 });
  }
}
