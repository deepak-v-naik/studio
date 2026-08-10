'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, ListVideo, Plus, Trash2, AlertCircle, Film, ImageIcon, GripVertical, X, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getPlaylists, createPlaylist, updatePlaylist, deletePlaylist, getContent, type Playlist, type Content } from '@/lib/backend-api';
import { toast } from '@/hooks/use-toast';

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function fmtMs(ms: number) {
  return ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(0)}s`;
}

const inp = 'w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';

type DraftItem = { contentId: string; durationMs: number; name: string; type: 'image' | 'video'; url: string };

export default function PlaylistsTab() {
  const [playlists,  setPlaylists]  = useState<Playlist[]>([]);
  const [content,    setContent]    = useState<Content[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [selected,   setSelected]   = useState<string | null>(null);
  const [newName,    setNewName]    = useState('');
  const [creating,   setCreating]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [draft,      setDraft]      = useState<DraftItem[]>([]);
  const [transition, setTransition] = useState<Playlist['transition']>('NONE');
  const [saved,      setSaved]      = useState(false);
  const [hasNested,  setHasNested]  = useState(false);

  // Drag-to-reorder refs
  const dragIdx     = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const load = useCallback(() => {
    Promise.all([getPlaylists(), getContent()])
      .then(([pl, ct]) => { setPlaylists(pl); setContent(ct.content); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectPlaylist = (pl: Playlist) => {
    setSelected(pl.id);
    // Playlists containing nested-playlist items (childPlaylistId set, content null) are
    // read-only here: this editor saves via full replace, so editing one would silently
    // drop the nested items it can't display. They stay editable via the API.
    setHasNested(pl.items.some((i) => i.childPlaylistId != null));
    setDraft(pl.items.filter((i) => i.content != null && i.contentId != null).map((i) => ({
      contentId:  i.contentId!,
      durationMs: i.durationMs,
      name:       i.content!.name,
      type:       i.content!.type,
      url:        i.content!.url,
    })));
    setTransition(pl.transition);
    setSaved(false);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const pl = await createPlaylist({ name: newName.trim(), items: [] });
      setPlaylists((p) => [pl, ...p]);
      setNewName('');
      selectPlaylist(pl);
      toast({ title: 'Playlist created', description: pl.name });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not create playlist', description: (err as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const addContent = (c: Content) => {
    if (draft.some((d) => d.contentId === c.id)) return;
    setDraft((d) => [...d, {
      contentId:  c.id,
      durationMs: c.durationMs ?? (c.type === 'video' ? 30000 : 10000),
      name:       c.name,
      type:       c.type,
      url:        c.url,
    }]);
    setSaved(false);
  };

  const removeItem = (contentId: string) => {
    setDraft((d) => d.filter((i) => i.contentId !== contentId));
    setSaved(false);
  };

  const updateDuration = (contentId: string, ms: number) => {
    setDraft((d) => d.map((i) => i.contentId === contentId ? { ...i, durationMs: ms } : i));
    setSaved(false);
  };

  // ── Drag reorder ────────────────────────────────────────────────────────────
  const reorder = () => {
    if (dragIdx.current === null || dragOverIdx.current === null) return;
    if (dragIdx.current === dragOverIdx.current) return;
    const next = [...draft];
    const [item] = next.splice(dragIdx.current, 1);
    next.splice(dragOverIdx.current, 0, item);
    setDraft(next);
    setSaved(false);
  };

  const save = async () => {
    if (!selected) return;
    if (hasNested) {
      toast({ variant: 'destructive', title: 'Read-only playlist', description: 'This playlist contains nested playlists, which this editor cannot display — saving would drop them. Edit it via the API.' });
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlaylist(selected, {
        items: draft.map((i) => ({ contentId: i.contentId, durationMs: i.durationMs })),
        transition,
      });
      setPlaylists((p) => p.map((pl) => pl.id === selected ? updated : pl));
      setSaved(true);
      toast({ title: 'Playlist saved ✓' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this playlist?')) return;
    setDeleting(id);
    try {
      await deletePlaylist(id);
      setPlaylists((p) => p.filter((x) => x.id !== id));
      if (selected === id) { setSelected(null); setDraft([]); }
      toast({ title: 'Playlist deleted' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: (err as Error).message });
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{[0,1,2].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      {[0,1,2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );
  if (error)   return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 flex gap-3">
      <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
      <div><p className="text-sm font-semibold text-foreground">Could not load playlists</p><p className="text-xs text-muted-foreground mt-0.5">{error}</p></div>
    </div>
  );

  const activePl = playlists.find((p) => p.id === selected);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* Left — playlist list */}
      <div className="space-y-3">
        {/* Create form */}
        <div className="rounded-xl border border-border bg-card p-3">
          <form onSubmit={create} className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New playlist name"
              className={inp}
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-40 whitespace-nowrap"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </form>
        </div>

        {!playlists.length ? (
          <p className="text-xs text-muted-foreground text-center py-6">No playlists yet.</p>
        ) : (
          <div className="space-y-1.5">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => selectPlaylist(pl)}
                className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  selected === pl.id ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/30'
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ListVideo className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{pl.name}</p>
                  <p className="text-[10px] text-muted-foreground">{pl.items.length} items · {fmtDate(pl.createdAt)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); del(pl.id); }}
                  disabled={deleting === pl.id}
                  className="flex items-center rounded-lg border border-destructive/20 bg-destructive/5 p-1.5 text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-40 shrink-0"
                >
                  {deleting === pl.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right — editor */}
      {!selected ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 py-20">
          <ListVideo className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Select or create a playlist</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Current items */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <p className="text-sm font-bold text-foreground">{activePl?.name}</p>
                <p className="text-[10px] text-muted-foreground">{draft.length} items · {fmtMs(draft.reduce((s, i) => s + i.durationMs, 0))} total · drag to reorder</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Transition</label>
                  <select
                    value={transition}
                    onChange={(e) => { setTransition(e.target.value as Playlist['transition']); setSaved(false); }}
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
                  >
                    <option value="NONE">None (cut)</option>
                    <option value="FADE">Fade</option>
                    <option value="SLIDE">Slide</option>
                  </select>
                </div>
                <button
                  onClick={save}
                  disabled={saving || hasNested}
                  title={hasNested ? 'Contains nested playlists — read-only in this editor' : undefined}
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-colors disabled:opacity-40 ${
                    saved ? 'bg-green-500/10 text-green-700 border border-green-500/30' : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
                  {saving ? 'Saving…' : saved ? 'Saved' : hasNested ? 'Read-only (nested)' : 'Save playlist'}
                </button>
              </div>
            </div>

            {!draft.length ? (
              <p className="text-xs text-muted-foreground text-center py-8">No items yet — add from content below</p>
            ) : (
              <div className="divide-y divide-border">
                {draft.map((item, idx) => (
                  <div
                    key={item.contentId}
                    draggable
                    onDragStart={(e) => {
                      dragIdx.current = idx;
                      setDraggingIdx(idx);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnter={() => { dragOverIdx.current = idx; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={() => {
                      reorder();
                      setDraggingIdx(null);
                      dragIdx.current = null;
                      dragOverIdx.current = null;
                    }}
                    className={`flex items-center gap-3 px-5 py-3 transition-opacity ${draggingIdx === idx ? 'opacity-40' : 'opacity-100'}`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing" />
                    <span className="text-[10px] text-muted-foreground/50 w-4">{idx + 1}</span>
                    {item.type === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="h-9 w-14 object-cover rounded-lg bg-muted shrink-0" />
                    ) : (
                      <video
                        src={item.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-9 w-14 object-cover rounded-lg bg-purple-500/10 shrink-0"
                      />
                    )}
                    <p className="flex-1 text-xs font-semibold text-foreground truncate">{item.name}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={1}
                        value={Math.round(item.durationMs / 1000)}
                        onChange={(e) => updateDuration(item.contentId, Number(e.target.value) * 1000)}
                        className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-xs text-center text-foreground focus:outline-none focus:border-primary"
                      />
                      <span className="text-[10px] text-muted-foreground">sec</span>
                    </div>
                    <button onClick={() => removeItem(item.contentId)} className="rounded-lg p-1 text-muted-foreground/50 hover:text-destructive transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Content picker */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Add content</p>
            {!content.length ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No content uploaded yet. Go to Content tab first.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
                {content.map((c) => {
                  const added = draft.some((d) => d.contentId === c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => addContent(c)}
                      disabled={added}
                      className={`relative rounded-xl border overflow-hidden text-left transition-all ${
                        added ? 'border-green-500/40 opacity-50 cursor-default' : 'border-border hover:border-primary/40 hover:shadow-sm'
                      }`}
                    >
                      {c.type === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.url} alt="" className="h-20 w-full object-cover bg-muted" />
                      ) : (
                        <div className="relative h-20 w-full bg-purple-500/10 group">
                          <video
                            src={c.url}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            className="h-20 w-full object-cover"
                            onMouseEnter={(e) => e.currentTarget.play()}
                            onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                          />
                          <Film className="pointer-events-none absolute bottom-1 right-1 h-3.5 w-3.5 text-white drop-shadow" />
                        </div>
                      )}
                      <div className="px-2 py-1.5">
                        <p className="text-[10px] font-semibold text-foreground truncate">{c.name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          {c.type === 'video'
                            ? <Film className="h-2.5 w-2.5 text-purple-500" />
                            : <ImageIcon className="h-2.5 w-2.5 text-blue-500" />}
                          <span className="text-[9px] text-muted-foreground">{c.type}</span>
                        </div>
                      </div>
                      {added && (
                        <div className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
                          <Check className="h-3 w-3 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
