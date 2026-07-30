'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check, Settings2 } from 'lucide-react';
import { getPlayerConfig, updatePlayerConfig, getPlaylists, type PlayerConfig, type Playlist } from '@/lib/backend-api';
import { toast } from '@/hooks/use-toast';

const inp = 'w-24 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-center text-foreground focus:outline-none focus:border-primary';

export default function PlayerConfigPanel() {
  const [config,    setConfig]    = useState<PlayerConfig | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  useEffect(() => {
    Promise.all([
      getPlayerConfig().then(setConfig),
      getPlaylists().then(setPlaylists).catch(() => {}),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof PlayerConfig>(key: K, value: PlayerConfig[K]) => {
    setConfig((c) => c ? { ...c, [key]: value } : c);
    setSaved(false);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await updatePlayerConfig({
        retryIntervalMs:          config.retryIntervalMs,
        transitionDurationMs:     config.transitionDurationMs,
        kioskKeyLockEnabled:      config.kioskKeyLockEnabled,
        downloadConnectTimeoutMs: config.downloadConnectTimeoutMs,
        downloadReadTimeoutMs:    config.downloadReadTimeoutMs,
        fallbackPlaylistId:       config.fallbackPlaylistId,
        testPlaylistId:           config.testPlaylistId,
      });
      setConfig(updated);
      setSaved(true);
      toast({ title: 'Player config saved ✓', description: 'Screens pick this up on their next schedule poll.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!config)  return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-bold text-foreground">Player behavior</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${
            saved ? 'bg-green-500/10 text-green-700 border border-green-500/30' : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Applies fleet-wide on each screen&apos;s next schedule poll — no APK update needed.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Retry interval (sec)</span>
          <input type="number" min={5} className={inp}
            value={Math.round(config.retryIntervalMs / 1000)}
            onChange={(e) => update('retryIntervalMs', Number(e.target.value) * 1000)} />
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Transition (ms)</span>
          <input type="number" min={0} step={100} className={inp}
            value={config.transitionDurationMs}
            onChange={(e) => update('transitionDurationMs', Number(e.target.value))} />
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Connect timeout (sec)</span>
          <input type="number" min={5} className={inp}
            value={Math.round(config.downloadConnectTimeoutMs / 1000)}
            onChange={(e) => update('downloadConnectTimeoutMs', Number(e.target.value) * 1000)} />
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Read timeout (sec)</span>
          <input type="number" min={5} className={inp}
            value={Math.round(config.downloadReadTimeoutMs / 1000)}
            onChange={(e) => update('downloadReadTimeoutMs', Number(e.target.value) * 1000)} />
        </label>

        <label className="flex items-center gap-2 pt-4">
          <input type="checkbox" className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
            checked={config.kioskKeyLockEnabled}
            onChange={(e) => update('kioskKeyLockEnabled', e.target.checked)} />
          <span className="text-[11px] font-semibold text-foreground">Kiosk key lock</span>
        </label>

        <label className="space-y-1 col-span-2 sm:col-span-1">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Fallback playlist</span>
          <select
            value={config.fallbackPlaylistId ?? ''}
            onChange={(e) => update('fallbackPlaylistId', e.target.value || null)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
          >
            <option value="">None (waiting screen)</option>
            {playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>{pl.name}</option>
            ))}
          </select>
          <span className="block text-[10px] text-muted-foreground">Plays when no schedule window is active — screens never sit idle.</span>
        </label>

        <label className="space-y-1 col-span-2 sm:col-span-1">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Test playlist</span>
          <select
            value={config.testPlaylistId ?? ''}
            onChange={(e) => update('testPlaylistId', e.target.value || null)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
          >
            <option value="">Auto (newest playlist with content)</option>
            {playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>{pl.name}</option>
            ))}
          </select>
          <span className="block text-[10px] text-muted-foreground">Used by &ldquo;Test screen&rdquo; in Screens. Keep it short so tests confirm fast.</span>
        </label>
      </div>
    </div>
  );
}
