'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Film, ImageIcon, Trash2, Upload, X, CheckCircle2, HardDrive, Tag, FolderOpen, Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { getContent, deleteContent, initiateUpload, updateContentMeta, type Content } from '@/lib/backend-api';
import { toast } from '@/hooks/use-toast';

function fmtBytes(b: number): string {
  if (b < 1024)         return `${b} B`;
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

async function md5Hex(file: File): Promise<string> {
  // Web Crypto doesn't support MD5; use full SHA-256 hex as the cache key.
  // Must NOT be truncated to 32 chars: the player's hashMatches() picks MD5
  // vs SHA-256 purely by string length (<=32 -> MD5), so a truncated SHA-256
  // gets misread as a real MD5 digest and never verifies — content downloads
  // forever fail integrity checks and never become playable.
  try {
    const buf    = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `nohash-${Date.now()}`;
  }
}

type UploadState = { name: string; progress: number; done: boolean; error?: string };

export default function ContentTab() {
  const [content,    setContent]    = useState<Content[]>([]);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [loading,    setLoading]    = useState(true);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [uploads,    setUploads]    = useState<UploadState[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [activeTag,    setActiveTag]    = useState<string | null>(null);
  const [editTagId,    setEditTagId]    = useState<string | null>(null);
  const [tagInput,     setTagInput]     = useState('');
  const [folderInput,  setFolderInput]  = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    setLoading(true);
    getContent()
      .then((r) => { setContent(r.content); setTotalBytes(r.totalBytes); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  // Derived lists for sidebar
  const allFolders = [...new Set(content.map((c) => c.folder).filter(Boolean))] as string[];
  const allTags    = [...new Set(content.flatMap((c) => c.tags ?? []))].sort();

  const filtered = content.filter((c) => {
    if (activeFolder && c.folder !== activeFolder) return false;
    if (activeTag    && !(c.tags ?? []).includes(activeTag)) return false;
    return true;
  });

  const openTagEdit = (c: Content) => {
    setEditTagId(c.id);
    setTagInput((c.tags ?? []).join(', '));
    setFolderInput(c.folder ?? '');
  };

  const saveTagEdit = async (id: string) => {
    const tags   = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    const folder = folderInput.trim() || null;
    try {
      await updateContentMeta(id, { tags, folder });
      setContent((prev) => prev.map((c) => c.id === id ? { ...c, tags, folder: folder ?? undefined } : c));
      toast({ title: 'Tags saved ✓' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Save failed', description: (e as Error).message });
    } finally { setEditTagId(null); }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this content item?')) return;
    setDeleting(id);
    try {
      await deleteContent(id);
      setContent((c) => c.filter((x) => x.id !== id));
      toast({ title: 'Content deleted' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: (err as Error).message });
    } finally {
      setDeleting(null);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    // Vercel serverless body limit is ~4.5 MB. Anything over fails with 413.
    const MAX_MB = 4;
    const pw = typeof window !== 'undefined' ? (sessionStorage.getItem('alive_admin_pw') ?? '') : '';

    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) {
        setUploads((u) => [...u, { name: file.name, progress: 0, done: false, error: 'Only image or video files are supported.' }]);
        continue;
      }

      if (file.size > MAX_MB * 1024 * 1024) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        setUploads((u) => [...u, {
          name:     file.name,
          progress: 0,
          done:     false,
          error:    `Too large (${mb} MB). Compress to under ${MAX_MB} MB — try HandBrake (video) or TinyPNG (image).`,
        }]);
        continue;
      }

      const idx = uploads.length;
      setUploads((u) => [...u, { name: file.name, progress: 0, done: false }]);

      try {
        const hash = await md5Hex(file);

        // Step 1: create DB record + get objectKey
        const { objectKey } = await initiateUpload({
          name:      file.name.replace(/\.[^.]+$/, ''),
          type:      isVideo ? 'video' : 'image',
          mimeType:  file.type || undefined,
          sizeBytes: file.size,
          md5:       hash,
        });

        // Step 2: server-side proxy upload to R2 (avoids CORS with direct R2 PUT)
        const form = new FormData();
        form.append('file', file);
        form.append('key', objectKey);

        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setUploads((u) => u.map((x, i) => i === idx ? { ...x, progress: pct } : x));
        };
        await new Promise<void>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status < 300) { resolve(); return; }
            const mb = (file.size / (1024 * 1024)).toFixed(1);
            if (xhr.status === 413) {
              reject(new Error(`File too large (${mb} MB). Server allows up to ~4.5 MB per upload on this plan. Compress the video or try a smaller file.`));
              return;
            }
            if (xhr.status === 401) { reject(new Error('Session expired — please reload the admin page and sign in again.')); return; }
            if (xhr.status === 504 || xhr.status === 502) { reject(new Error(`Upload timed out (${mb} MB). Try a smaller file or check your internet connection.`)); return; }
            try {
              const body = JSON.parse(xhr.responseText) as { error?: string };
              reject(new Error(body.error ?? `Couldn't upload "${file.name}" (server returned ${xhr.status}).`));
            } catch { reject(new Error(`Couldn't upload "${file.name}" (server returned ${xhr.status}).`)); }
          };
          xhr.onerror = () => reject(new Error('Upload failed — check your internet connection or try a smaller file.'));
          xhr.onabort = () => reject(new Error('Upload cancelled.'));
          xhr.open('POST', '/api/admin/r2-upload');
          if (pw) xhr.setRequestHeader('admin-password', pw);
          xhr.send(form);
        });

        setUploads((u) => u.map((x, i) => i === idx ? { ...x, progress: 100, done: true } : x));
        toast({ title: `${file.name} uploaded ✓` });
      } catch (err) {
        const msg = (err as Error).message;
        setUploads((u) => u.map((x, i) => i === idx ? { ...x, error: msg } : x));
        toast({ variant: 'destructive', title: 'Upload failed', description: msg });
      }
    }

    setTimeout(reload, 800);
  };

  const images   = content.filter((c) => c.type === 'image').length;
  const videos   = content.filter((c) => c.type === 'video').length;
  const usedMB   = totalBytes / (1024 * 1024);
  const limitGB  = 10; // R2 free tier
  const usedPct  = Math.min((usedMB / (limitGB * 1024)) * 100, 100);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Images',  value: images, icon: ImageIcon,  color: 'text-blue-500'   },
          { label: 'Videos',  value: videos, icon: Film,        color: 'text-purple-500' },
          { label: 'Storage', value: `${usedMB.toFixed(1)} MB`, icon: HardDrive, color: 'text-orange-500' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <s.icon className={`h-4 w-4 ${s.color} mb-2`} />
            <p className="text-xl font-bold text-foreground">{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
      {/* Storage bar */}
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex justify-between items-center mb-1.5">
          <p className="text-[11px] font-semibold text-foreground">R2 storage</p>
          <p className="text-[10px] text-muted-foreground">{usedMB.toFixed(1)} MB / {limitGB} GB</p>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full transition-all ${usedPct > 80 ? 'bg-red-500' : usedPct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${usedPct}%` }} />
        </div>
      </div>

      {/* Upload dropzone */}
      <div
        className="rounded-xl border-2 border-dashed border-border bg-muted/20 p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      >
        <Upload className="h-7 w-7 mx-auto mb-2 text-muted-foreground/50 group-hover:text-primary/70 transition-colors" />
        <p className="text-sm font-semibold text-foreground">Drop files here or click to upload</p>
        <p className="text-xs text-muted-foreground/60 mt-1">MP4 video · JPG / PNG / WebP image · Max 4 MB per file</p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">Larger videos? Compress with HandBrake to ~3 MB at 720p first.</p>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              {u.done
                ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                : u.error
                  ? <X className="h-4 w-4 text-destructive shrink-0" />
                  : <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{u.name}</p>
                {!u.done && !u.error && (
                  <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-200" style={{ width: `${u.progress}%` }} />
                  </div>
                )}
                {u.error && <p className="text-[10px] text-destructive mt-0.5">{u.error}</p>}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {u.done ? 'Done' : u.error ? 'Failed' : `${u.progress}%`}
              </span>
            </div>
          ))}
          <button
            onClick={() => setUploads([])}
            className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Folder / tag filters */}
      {(allFolders.length > 0 || allTags.length > 0) && (
        <div className="flex flex-wrap gap-2 items-center">
          {allFolders.length > 0 && (
            <>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1"><FolderOpen className="h-3 w-3" /> Folders:</span>
              {allFolders.map((f) => (
                <button key={f} onClick={() => setActiveFolder(activeFolder === f ? null : f)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-colors ${activeFolder === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >{f}</button>
              ))}
              {activeFolder && <button onClick={() => setActiveFolder(null)} className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors ml-1">Clear</button>}
            </>
          )}
          {allFolders.length > 0 && allTags.length > 0 && <span className="text-border">|</span>}
          {allTags.length > 0 && (
            <>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Tags:</span>
              {allTags.map((t) => (
                <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-colors ${activeTag === t ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >{t}</button>
              ))}
              {activeTag && <button onClick={() => setActiveTag(null)} className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors ml-1">Clear</button>}
            </>
          )}
        </div>
      )}

      {/* Library */}
      {loading ? (
        <div className="space-y-2">
          {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : !content.length ? (
        <p className="text-sm text-muted-foreground text-center py-10">No content yet. Upload images or videos above.</p>
      ) : !filtered.length ? (
        <p className="text-sm text-muted-foreground text-center py-10">No content matches the current filter.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {['', 'Name', 'Type', 'Size', 'Added', 'Tags / Folder'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{h}</th>
                ))}
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 w-10">
                    {c.type === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.url} alt="" className="h-8 w-12 object-cover rounded-lg bg-muted" />
                    ) : (
                      <div className="flex h-8 w-12 items-center justify-center rounded-lg bg-purple-500/10">
                        <Film className="h-4 w-4 text-purple-600" />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground max-w-[160px] truncate">{c.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.type === 'video' ? 'purple' : 'info'} className="text-[10px] py-0.5 px-2 font-bold">
                      {c.type === 'video' ? <Film className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
                      {c.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtBytes(c.sizeBytes)}</td>
                  <td className="px-4 py-3 text-muted-foreground/60">{fmtDate(c.createdAt)}</td>
                  <td className="px-4 py-3 max-w-[200px]">
                    {editTagId === c.id ? (
                      <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          placeholder="Tags (comma-separated)"
                          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none"
                        />
                        <input
                          value={folderInput}
                          onChange={(e) => setFolderInput(e.target.value)}
                          placeholder="Folder (optional)"
                          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none"
                        />
                        <div className="flex gap-1">
                          <button onClick={() => saveTagEdit(c.id)} className="rounded-lg bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Save</button>
                          <button onClick={() => setEditTagId(null)} className="rounded-lg border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1 items-center">
                        {(c.tags ?? []).map((t) => (
                          <span key={t} className="rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold">{t}</span>
                        ))}
                        {c.folder && <span className="rounded-full bg-orange-500/10 text-orange-600 px-1.5 py-0.5 text-[10px] font-semibold flex items-center gap-0.5"><FolderOpen className="h-2.5 w-2.5" />{c.folder}</span>}
                        <button onClick={() => openTagEdit(c)} className="rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-colors flex items-center gap-0.5">
                          <Plus className="h-2 w-2" /> tag
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => del(c.id)}
                      disabled={deleting === c.id}
                      className="flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1 text-[10px] font-semibold text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-40"
                    >
                      {deleting === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
