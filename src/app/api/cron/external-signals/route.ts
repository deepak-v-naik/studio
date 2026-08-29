import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { collectMarketSentimentSignals } from '@/lib/data-sources/market-sentiment';
import { collectCompetitorActivitySignals } from '@/lib/data-sources/competitor-activity';
import { collectInfraCostEfficiencySignals } from '@/lib/data-sources/infra-cost-efficiency';
import { isCronAuthorized } from '@/lib/cron-auth';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!isCronAuthorized(auth)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const [market, competitors, infra] = await Promise.all([
    collectMarketSentimentSignals(now),
    collectCompetitorActivitySignals(now),
    collectInfraCostEfficiencySignals(now),
  ]);

  const allSignals = [...market, ...competitors, ...infra];

  await db.$transaction(
    allSignals.map((signal) =>
      db.externalSignal.upsert({
        where: { source_sourceId: { source: signal.source, sourceId: signal.sourceId } },
        update: {
          observedAt: signal.observedAt,
          expiresAt: signal.expiresAt,
          category: signal.category,
          summary: signal.summary,
          details: signal.details as Prisma.InputJsonValue,
          score: signal.score,
          trendVelocity: signal.trendVelocity,
          confidence: signal.confidence,
          freshness: signal.freshness,
          severity: signal.severity,
          recommendedActions: signal.recommendedActions as Prisma.InputJsonValue,
        },
        create: {
          source: signal.source,
          sourceId: signal.sourceId,
          observedAt: signal.observedAt,
          expiresAt: signal.expiresAt,
          category: signal.category,
          summary: signal.summary,
          details: signal.details as Prisma.InputJsonValue,
          score: signal.score,
          trendVelocity: signal.trendVelocity,
          confidence: signal.confidence,
          freshness: signal.freshness,
          severity: signal.severity,
          recommendedActions: signal.recommendedActions as Prisma.InputJsonValue,
        },
      }),
    ),
  );

  return NextResponse.json({ ok: true, ingested: allSignals.length, bySource: { market: market.length, competitors: competitors.length, infra: infra.length } });
}
