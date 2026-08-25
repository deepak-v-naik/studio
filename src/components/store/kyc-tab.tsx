'use client';

import { useState, useEffect, useRef, ChangeEvent } from 'react';
import {
  Loader2, ShieldCheck, AlertCircle, Clock, CheckCircle2, Camera, FileText, IdCard, X, Upload,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { storeFetch } from '@/lib/store-fetch';

type KycStatus = 'not_started' | 'submitted' | 'approved' | 'rejected';

type KycData = {
  status:          KycStatus;
  panUrl:          string | null;
  aadhaarUrl:      string | null;
  selfieUrl:       string | null;
  aadhaarLast4:    string | null;
  submittedAt:     string | null;
  verifiedAt:      string | null;
  rejectedReason:  string | null;
};

const STATUS_COPY: Record<KycStatus, { label: string; color: string; desc: string; icon: React.ElementType }> = {
  not_started: { label: 'Not submitted',    color: 'text-muted-foreground', desc: 'Upload your documents to start verification.',         icon: ShieldCheck },
  submitted:   { label: 'Under review',     color: 'text-amber-600',        desc: 'Our team is reviewing your documents (1–2 days).',    icon: Clock        },
  approved:    { label: 'Verified ✓',       color: 'text-green-600',        desc: 'Your KYC is verified. Payouts unlocked.',             icon: CheckCircle2 },
  rejected:    { label: 'Needs correction', color: 'text-destructive',      desc: 'Please re-upload the requested documents.',           icon: AlertCircle  },
};

type DocSlot = 'pan' | 'aadhaar' | 'selfie';

const SLOTS: { key: DocSlot; label: string; hint: string; icon: React.ElementType }[] = [
  { key: 'pan',     label: 'PAN card',         hint: 'Clear photo, all corners visible',     icon: IdCard   },
  { key: 'aadhaar', label: 'Aadhaar card',     hint: 'Front side with photo & name',         icon: FileText },
  { key: 'selfie',  label: 'Selfie',           hint: 'A clear photo of your face',           icon: Camera   },
];

export default function KycTab() {
  const [data,     setData]    = useState<KycData | null>(null);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState<string | null>(null);

  // Local upload state — populated by user before submit
  const [uploads, setUploads] = useState<Record<DocSlot, string | null>>({ pan: null, aadhaar: null, selfie: null });
  const [uploadingSlot, setUploadingSlot] = useState<DocSlot | null>(null);
  const [aadhaarLast4,  setAadhaarLast4]  = useState('');
  const [submitting,    setSubmitting]    = useState(false);

  const refs: Record<DocSlot, React.RefObject<HTMLInputElement>> = {
    pan:     useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>,
    aadhaar: useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>,
    selfie:  useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>,
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await storeFetch('/api/stores/kyc');
      if (res.ok) {
        const d = await res.json() as KycData;
        setData(d);
        setUploads({ pan: d.panUrl, aadhaar: d.aadhaarUrl, selfie: d.selfieUrl });
        if (d.aadhaarLast4) setAadhaarLast4(d.aadhaarLast4);
      } else if (res.status === 401) {
        // A 401 must not render as "KYC not submitted" — that reads like the
        // partner's approved documents were lost.
        setError('Session expired — please log in again to see your KYC status.');
      }
    } catch {
      setError('Could not load KYC status. Check your connection and retry.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const uploadFile = async (slot: DocSlot, file: File) => {
    if (!file.type.startsWith('image/')) { setError('Only image files allowed.'); return; }
    if (file.size > 4 * 1024 * 1024)     { setError('Image too large — keep under 4 MB.'); return; }
    setUploadingSlot(slot); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await storeFetch('/api/stores/upload', { method: 'POST', body: fd });
      const d   = await res.json() as { url?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Upload failed');
      setUploads((u) => ({ ...u, [slot]: d.url ?? null }));
    } catch (e) { setError((e as Error).message); }
    finally { setUploadingSlot(null); }
  };

  const onFileChange = (slot: DocSlot) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void uploadFile(slot, f);
  };

  const submit = async () => {
    if (!uploads.pan || !uploads.aadhaar || !uploads.selfie) {
      setError('Please upload all three documents before submitting.');
      return;
    }
    setSubmitting(true); setError(null);
    try {
      const res = await storeFetch('/api/stores/kyc', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          panUrl:        uploads.pan,
          aadhaarUrl:    uploads.aadhaar,
          selfieUrl:     uploads.selfie,
          aadhaarLast4:  aadhaarLast4 || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? 'Submission failed');
      }
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">{[0,1,2].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  }

  const status = data?.status ?? 'not_started';
  const meta   = STATUS_COPY[status];
  const Icon   = meta.icon;
  const canEdit = status === 'not_started' || status === 'rejected';
  const allUploaded = uploads.pan && uploads.aadhaar && uploads.selfie;

  return (
    <div className="space-y-4">

      {/* Status card */}
      <div className={`rounded-2xl border bg-card p-5 ${status === 'approved' ? 'border-green-300' : status === 'rejected' ? 'border-destructive/30' : 'border-border'}`}>
        <div className="flex items-start gap-3">
          <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${meta.color}`} />
          <div className="flex-1">
            <p className={`text-sm font-bold ${meta.color}`}>{meta.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{meta.desc}</p>
            {data?.verifiedAt && (
              <p className="text-[10px] text-green-600/70 mt-1">
                Verified on {new Date(data.verifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
            {data?.submittedAt && status === 'submitted' && (
              <p className="text-[10px] text-amber-600/70 mt-1">
                Submitted {new Date(data.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </p>
            )}
            {status === 'rejected' && data?.rejectedReason && (
              <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs text-destructive font-semibold">Reason:</p>
                <p className="text-xs text-destructive/80">{data.rejectedReason}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Why KYC */}
      {status === 'not_started' && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-bold text-foreground">Why complete KYC?</h2>
          <div className="space-y-2">
            {[
              "Verify your identity under ALIVE's partner agreement",
              'Unlock monthly payouts (₹500 + electricity per month per screen)',
              'One-time submission — takes less than 2 minutes',
              'Your documents are only shared with the ALIVE team for verification',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document slots */}
      {(canEdit || status === 'submitted') && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-bold text-foreground">Your documents</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SLOTS.map(({ key, label, hint, icon: SlotIcon }) => {
              const url      = uploads[key];
              const isLoading = uploadingSlot === key;
              return (
                <div key={key} className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                  {url ? (
                    <div className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={label} className="w-full aspect-[3/2] rounded-xl object-cover border border-border" />
                      {canEdit && (
                        <button onClick={() => { setUploads((u) => ({ ...u, [key]: null })); refs[key].current?.click(); }}
                          className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl bg-black/60 text-white text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                          <Upload className="h-3.5 w-3.5" /> Replace
                        </button>
                      )}
                    </div>
                  ) : canEdit ? (
                    <button onClick={() => refs[key].current?.click()} disabled={isLoading}
                      className="w-full aspect-[3/2] rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/30 transition-colors flex flex-col items-center justify-center gap-1.5 disabled:opacity-50">
                      {isLoading
                        ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        : <>
                            <SlotIcon className="h-5 w-5 text-muted-foreground/50" />
                            <p className="text-[10px] text-muted-foreground/50">Tap to upload</p>
                          </>
                      }
                    </button>
                  ) : (
                    <div className="w-full aspect-[3/2] rounded-xl bg-muted flex items-center justify-center">
                      <SlotIcon className="h-5 w-5 text-muted-foreground/30" />
                    </div>
                  )}
                  <p className="text-[9px] text-muted-foreground/50">{hint}</p>
                  <input ref={refs[key]} type="file" accept="image/*" capture={key === 'selfie' ? 'user' : undefined}
                    className="hidden" onChange={onFileChange(key)} />
                </div>
              );
            })}
          </div>

          {canEdit && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Aadhaar — last 4 digits <span className="normal-case font-normal text-muted-foreground/50">(for reference)</span>
              </label>
              <input
                type="text" inputMode="numeric" maxLength={4}
                value={aadhaarLast4}
                onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                className="w-full max-w-[140px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-center font-mono tracking-[0.3em] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {canEdit && (
            <button
              onClick={submit}
              disabled={!allUploaded || submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-red-500 to-red-700 py-3 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(220,38,38,0.4)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                : <><ShieldCheck className="h-4 w-4" /> Submit for verification</>
              }
            </button>
          )}
        </div>
      )}

      <p className="text-[10px] text-center text-muted-foreground/50 leading-relaxed">
        Your documents are stored securely and only visible to the ALIVE verification team.
      </p>
    </div>
  );
}
