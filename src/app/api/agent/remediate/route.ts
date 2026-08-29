import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { isCronAuthorized } from '@/lib/cron-auth';

type AgentOption = {
  rank: number;
  actionType: 'CONFIG_CHANGE' | 'ROLLBACK' | 'PATCH_TARGET';
  title: string;
  rationale: string;
  proposedChange: Record<string, unknown>;
  confidence: number;
  blastRadius: string;
  blastRadiusScore: number;
};

function normalizeOptions(raw: unknown): AgentOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x, i) => {
      const item = x as Partial<AgentOption>;
      return {
        rank: item.rank ?? i + 1,
        actionType: item.actionType ?? 'CONFIG_CHANGE',
        title: item.title ?? `Remediation option ${i + 1}`,
        rationale: item.rationale ?? 'No rationale supplied.',
        proposedChange: item.proposedChange ?? {},
        confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)),
        blastRadius: item.blastRadius ?? 'device',
        blastRadiusScore: Math.max(1, Math.min(5, item.blastRadiusScore ?? 1)),
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);
}

async function askDiagnosticAgent(context: Record<string, unknown>): Promise<AgentOption[]> {
  const endpoint = process.env.INTERNAL_DIAGNOSTIC_AGENT_URL;
  if (!endpoint) {
    return [
      {
        rank: 1,
        actionType: 'CONFIG_CHANGE',
        title: 'Tune heartbeat grace window',
        rationale: 'Missing heartbeats suggest network jitter or tight timeout settings.',
        proposedChange: { heartbeatGraceWindows: 4 },
        confidence: 0.62,
        blastRadius: 'device',
        blastRadiusScore: 1,
      },
      {
        rank: 2,
        actionType: 'ROLLBACK',
        title: 'Rollback recent scheduling change',
        rationale: 'Potential schedule regression after recent updates.',
        proposedChange: { rollbackTarget: 'latest-schedule-revision' },
        confidence: 0.48,
        blastRadius: 'group',
        blastRadiusScore: 3,
      },
    ];
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      promptType: 'device_remediation',
      context,
      request: 'Return ranked remediation options for CONFIG_CHANGE, ROLLBACK, PATCH_TARGET with confidence and blast radius metadata.',
    }),
  });

  if (!response.ok) {
    throw new Error(`Diagnostic agent error: ${response.status}`);
  }

  const payload = await response.json() as { options?: unknown[] };
  return normalizeOptions(payload.options);
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!isCronAuthorized(auth)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const lookback = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const openTickets = await db.remediationTicket.findMany({
    where: { status: 'OPEN' },
    include: { device: true },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });

  let proposalsCreated = 0;

  for (const ticket of openTickets) {
    const scheduleOrFilters: Array<Record<string, unknown>> = [{ deviceIds: { has: ticket.deviceId } }];
    if (ticket.device.groupName) scheduleOrFilters.push({ groupName: ticket.device.groupName });

    const [recentEvents, schedules, externalSignals, existingProposals] = await Promise.all([
      db.playEvent.findMany({
        where: { deviceId: ticket.deviceId, startedAt: { gte: lookback } },
        orderBy: { startedAt: 'desc' },
        take: 100,
      }),
      db.schedule.findMany({
        where: { OR: scheduleOrFilters },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      db.externalSignal.findMany({
        where: { expiresAt: { gt: now } },
        orderBy: [{ severity: 'desc' }, { observedAt: 'desc' }],
        take: 12,
      }),
      db.remediationProposal.count({ where: { ticketId: ticket.id } }),
    ]);

    if (existingProposals > 0) continue;

    const context = {
      ticket,
      device: {
        id: ticket.device.id,
        status: ticket.device.status,
        lastSeen: ticket.device.lastSeen,
        uptimePctD30: ticket.device.uptimePctD30,
        groupName: ticket.device.groupName,
      },
      recentEvents,
      schedules,
      externalSignals,
    };

    const options = await askDiagnosticAgent(context);
    for (const option of options) {
      const lowRiskConfigAutoApply = option.actionType === 'CONFIG_CHANGE' && option.blastRadiusScore <= 2 && option.confidence >= 0.75;
      const requiresApproval = option.actionType === 'PATCH_TARGET' || option.actionType === 'ROLLBACK';

      await db.remediationProposal.create({
        data: {
          ticketId: ticket.id,
          rank: option.rank,
          actionType: option.actionType,
          title: option.title,
          rationale: option.rationale,
          proposedChange: option.proposedChange as Prisma.InputJsonValue,
          confidence: option.confidence,
          blastRadius: option.blastRadius,
          blastRadiusScore: option.blastRadiusScore,
          applyMode: lowRiskConfigAutoApply ? 'AUTO' : 'REQUIRES_APPROVAL',
          requiresApproval,
          approvalState: requiresApproval ? 'PENDING' : 'NOT_REQUIRED',
          prHookState: option.actionType === 'PATCH_TARGET' ? 'READY_FOR_PR_HOOK' : 'NOT_REQUIRED',
        },
      });
      proposalsCreated++;
    }
  }

  return NextResponse.json({ ok: true, ticketsProcessed: openTickets.length, proposalsCreated });
}
