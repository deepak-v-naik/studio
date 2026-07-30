'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, PlayCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { startScreenTest, checkScreenTest } from '@/lib/backend-api';
import { toast } from '@/hooks/use-toast';

// A screen that is frozen, black, or stuck mid-download still heartbeats and still
// reads ONLINE. So this pushes known content at top priority and waits for a
// proof-of-play row: actual evidence the panel is rendering, not just reachable.

type Phase = 'idle' | 'starting' | 'waiting' | 'confirmed' | 'timeout' | 'error';

const POLL_MS    = 3_000;
const TIMEOUT_MS = 90_000;

export default function ScreenTestButton({ deviceId }: { deviceId: string }) {
  const [phase,  setPhase]  = useState<Phase>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Polling must not outlive the row (screens list re-renders/paginates constantly).
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const run = async () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('starting');
    setDetail(null);

    try {
      const { startedAt } = await startScreenTest(deviceId);
      setPhase('waiting');

      const deadline = Date.now() + TIMEOUT_MS;
      const poll = async () => {
        try {
          const s = await checkScreenTest(deviceId, startedAt);
          if (s.confirmed) {
            setPhase('confirmed');
            setDetail(null);
            toast({ title: 'Screen confirmed live ✓', description: 'Test content played on the panel.' });
            return;
          }
          if (Date.now() >= deadline) {
            setPhase('timeout');
            // Distinguish the failure modes — this is the whole point of the test.
            const stale = s.lastSeen == null;
            const frozen = s.playbackAliveAt != null && s.lastSeen != null &&
              new Date(s.lastSeen).getTime() - new Date(s.playbackAliveAt).getTime() > 120_000;
            setDetail(
              s.lastStallReason ? `Player reported a stall: ${s.lastStallReason}`
              : stale            ? 'Device has never checked in — it may be powered off or offline.'
              : frozen           ? 'Device is online but playback has not advanced — screen looks frozen.'
              :                    'Device is online but did not report playing anything. Content may still be downloading.',
            );
            return;
          }
          timers.current.push(setTimeout(poll, POLL_MS));
        } catch (err) {
          setPhase('error');
          setDetail((err as Error).message);
        }
      };
      timers.current.push(setTimeout(poll, POLL_MS));
    } catch (err) {
      setPhase('error');
      setDetail((err as Error).message);
      toast({ variant: 'destructive', title: 'Could not start test', description: (err as Error).message });
    }
  };

  const busy = phase === 'starting' || phase === 'waiting';

  const label =
    phase === 'starting'  ? 'Starting…'
    : phase === 'waiting' ? 'Waiting for playback…'
    : phase === 'confirmed' ? 'Confirmed live'
    : phase === 'timeout'  ? 'No playback'
    : phase === 'error'    ? 'Test failed'
    :                        'Test screen';

  const tone =
    phase === 'confirmed' ? 'border-green-500/30 bg-green-500/10 text-green-700'
    : phase === 'timeout' || phase === 'error' ? 'border-destructive/40 bg-destructive/5 text-destructive'
    : 'border-border text-muted-foreground hover:text-foreground';

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={run}
        disabled={busy}
        title="Play test content on this screen and wait for it to report back"
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors disabled:opacity-60 ${tone}`}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" />
          : phase === 'confirmed' ? <CheckCircle2 className="h-3 w-3" />
          : phase === 'timeout' || phase === 'error' ? <AlertTriangle className="h-3 w-3" />
          : <PlayCircle className="h-3 w-3" />}
        {label}
      </button>
      {detail && <span className="text-[9px] leading-tight text-muted-foreground max-w-[190px]">{detail}</span>}
    </div>
  );
}
