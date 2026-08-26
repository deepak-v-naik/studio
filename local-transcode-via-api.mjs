#!/usr/bin/env node
// Variant of local-transcode.mjs for when R2 credentials are unavailable locally.
//
// Why this exists: the R2 keys are stored as *Sensitive* env vars in Vercel, which are
// write-only — `vercel env pull` returns them as the literal string "[SENSITIVE]", so
// local-transcode.mjs can never talk to R2 directly from a dev machine. This variant
// uploads through the production app's own presigned-URL endpoint
// (GET /api/admin/r2-upload?key=&type= → PUT bytes to the returned uploadUrl), which
// runs server-side where the real R2 creds live. The only secrets needed here are:
//   DATABASE_URL    — real value in studio/.env (not Vercel-sensitive)
//   ADMIN_PASSWORD  — pass in the shell:  ADMIN_PASSWORD='...' node local-transcode-via-api.mjs ...
//
// Everything else (targets, ffmpeg settings, Content-row end state) is identical to
// local-transcode.mjs — see its header for semantics and safety notes.
//
// Usage:
//   ADMIN_PASSWORD='...' node local-transcode-via-api.mjs <contentId> [...]
//   ADMIN_PASSWORD='...' node local-transcode-via-api.mjs --all-pending
//   ADMIN_PASSWORD='...' node local-transcode-via-api.mjs --playlist "name" [--dry-run] [--no-hevc]

import 'dotenv/config';
import { randomUUID, createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const run = promisify(execFile);
const db = new PrismaClient();

const SITE_BASE = (process.env.SITE_BASE || 'https://wearealive.in').replace(/\/+$/, '');
const PUBLIC_BASE = (
  process.env.R2_PUBLIC_BASE && process.env.R2_PUBLIC_BASE !== '[SENSITIVE]'
    ? process.env.R2_PUBLIC_BASE
    : 'https://media.wearealive.in'
).replace(/\/+$/, '');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const DRY = has('--dry-run');
const NO_HEVC = has('--no-hevc');
const playlistName = valOf('--playlist');
const allPending = has('--all-pending');
const explicitIds = args.filter((a) => !a.startsWith('--') && a !== playlistName);

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

function checkEnv() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL === '[SENSITIVE]') {
    die('DATABASE_URL missing/redacted — studio/.env should hold the real value.');
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === '[SENSITIVE]') {
    die("ADMIN_PASSWORD not set. Run as:  ADMIN_PASSWORD='<admin console password>' node local-transcode-via-api.mjs ...");
  }
}

function publicUrl(objectKey) { return PUBLIC_BASE + '/' + objectKey.replace(/^\/+/, ''); }

// Upload via the prod app: presign, then PUT. The signature covers Content-Type, so the
// PUT must send exactly the type that was presigned.
async function uploadViaApi(objectKey, bytes, contentType) {
  const presign = await fetch(
    `${SITE_BASE}/api/admin/r2-upload?key=${encodeURIComponent(objectKey)}&type=${encodeURIComponent(contentType)}`,
    { headers: { 'admin-password': process.env.ADMIN_PASSWORD } },
  );
  if (!presign.ok) throw new Error(`presign failed HTTP ${presign.status}: ${(await presign.text()).slice(0, 200)}`);
  const { uploadUrl } = await presign.json();
  if (!uploadUrl) throw new Error('presign response missing uploadUrl');
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  if (!put.ok) throw new Error(`R2 PUT failed HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
}

async function selectTargets() {
  if (explicitIds.length) {
    return db.content.findMany({ where: { id: { in: explicitIds } } });
  }
  if (playlistName) {
    const items = await db.playlistItem.findMany({
      where: { playlist: { name: { contains: playlistName, mode: 'insensitive' } }, contentId: { not: null } },
      include: { content: true },
    });
    const seen = new Map();
    for (const it of items) if (it.content && it.content.type === 'VIDEO') seen.set(it.content.id, it.content);
    return [...seen.values()];
  }
  if (allPending) {
    // NULL-inclusive: `NOT = 'done'` alone skips NULL rows (SQL three-valued logic),
    // and NULL is a real state — upload succeeded, browser transcode trigger never fired.
    return db.content.findMany({ where: { type: 'VIDEO', OR: [{ transcodeStatus: null }, { NOT: { transcodeStatus: 'done' } }] } });
  }
  die('Nothing selected. Pass content ids, or --playlist "<name>", or --all-pending. (--dry-run to preview.)');
}

async function ffmpegH264(inFile, outFile) {
  await run('ffmpeg', [
    '-y', '-i', inFile,
    '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,crop=trunc(iw/2)*2:trunc(ih/2)*2",
    '-r', '30', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    outFile,
  ], { maxBuffer: 1 << 26 });
}

async function ffmpegHevc(inFile, outFile) {
  await run('ffmpeg', [
    '-y', '-i', inFile,
    '-c:v', 'libx265', '-tag:v', 'hvc1', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,crop=trunc(iw/2)*2:trunc(ih/2)*2",
    '-r', '30', '-b:v', '3M', '-maxrate', '4M', '-bufsize', '6M',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    outFile,
  ], { maxBuffer: 1 << 26 });
}

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file,
  ]);
  const p = JSON.parse(stdout);
  return {
    width: p.streams?.[0]?.width,
    height: p.streams?.[0]?.height,
    durationMs: p.format?.duration ? Math.round(parseFloat(p.format.duration) * 1000) : undefined,
  };
}

async function processOne(c) {
  const tmp = os.tmpdir();
  const tmpIn = path.join(tmp, `${randomUUID()}-in`);
  const tmpOut = path.join(tmp, `${randomUUID()}-out.mp4`);
  const tmpHevc = path.join(tmp, `${randomUUID()}-hevc.mp4`);
  const src = publicUrl(c.originalObjectKey ?? c.objectKey); // never re-encode a rendition
  console.log(`\n▶ ${c.name}  (${c.id})`);
  console.log(`  source: ${src}`);

  await db.content.update({ where: { id: c.id }, data: { transcodeStatus: 'pending', transcodeError: null } });

  try {
    // 1. download
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`download failed HTTP ${resp.status}`);
    await writeFile(tmpIn, Buffer.from(await resp.arrayBuffer()));

    // 2. H.264 Main@4.1 (required baseline)
    console.log('  encoding H.264 Main@4.1…');
    await ffmpegH264(tmpIn, tmpOut);
    const { width, height, durationMs } = await probe(tmpOut);
    const outBytes = await readFile(tmpOut);
    const md5 = createHash('md5').update(outBytes).digest('hex');
    const objectKey = `content/${c.id}-transcoded-${Date.now()}.mp4`;
    await uploadViaApi(objectKey, outBytes, 'video/mp4');
    console.log(`  ✓ H.264 ${width}x${height} ${(outBytes.length / 1e6).toFixed(1)}MB → ${objectKey}`);

    // 3. HEVC (best-effort)
    let hevc = {};
    if (!NO_HEVC) {
      try {
        console.log('  encoding HEVC (best-effort)…');
        await ffmpegHevc(tmpIn, tmpHevc);
        const hb = await readFile(tmpHevc);
        const hevcObjectKey = `content/${c.id}-transcoded-hevc-${Date.now()}.mp4`;
        await uploadViaApi(hevcObjectKey, hb, 'video/mp4');
        hevc = { hevcObjectKey, hevcMd5: createHash('md5').update(hb).digest('hex'), hevcSizeBytes: BigInt(hb.length) };
        console.log(`  ✓ HEVC ${(hb.length / 1e6).toFixed(1)}MB → ${hevcObjectKey}`);
      } catch (e) {
        console.warn(`  ! HEVC failed (non-fatal): ${e.message}`);
      }
    }

    // 4. update Content row — same end-state as the transcode-callback route: the safe
    // rendition overwrites objectKey (rollback-safe legacy shape) and the pre-overwrite
    // original is snapshotted into original* (COALESCE — re-transcodes never clobber it).
    await db.$executeRaw`
      UPDATE "Content"
      SET "originalObjectKey" = COALESCE("originalObjectKey", "objectKey"),
          "originalMd5"       = COALESCE("originalMd5", "md5"),
          "originalSizeBytes" = COALESCE("originalSizeBytes", "sizeBytes"),
          "objectKey" = ${objectKey}, "md5" = ${md5}, "sizeBytes" = ${BigInt(outBytes.length)},
          "durationMs" = ${durationMs ?? null}, width = ${width ?? null}, height = ${height ?? null},
          "transcodeStatus" = 'done', "transcodeError" = NULL,
          "hevcObjectKey" = ${hevc.hevcObjectKey ?? null}, "hevcMd5" = ${hevc.hevcMd5 ?? null},
          "hevcSizeBytes" = ${hevc.hevcSizeBytes ?? null}
      WHERE id = ${c.id}
    `;
    console.log('  ✓ Content row updated (transcodeStatus=done)');
    return true;
  } catch (e) {
    await db.content.update({ where: { id: c.id }, data: { transcodeStatus: 'error', transcodeError: String(e.message || e) } }).catch(() => {});
    console.error(`  ✗ failed: ${e.message || e}`);
    return false;
  } finally {
    await Promise.all([tmpIn, tmpOut, tmpHevc].map((f) => unlink(f).catch(() => {})));
  }
}

async function main() {
  checkEnv();
  // Sanity: the public base must serve existing objects, or every download would 404.
  const probeRow = await db.content.findFirst({ where: { type: 'VIDEO' }, select: { objectKey: true } });
  if (probeRow) {
    const head = await fetch(publicUrl(probeRow.objectKey), { method: 'HEAD' });
    if (!head.ok) die(`public base ${PUBLIC_BASE} does not serve ${probeRow.objectKey} (HTTP ${head.status}). Set SITE_BASE/R2_PUBLIC_BASE and retry.`);
  }
  const targets = await selectTargets();
  if (!targets.length) die('No matching content found.');
  console.log(`Targets (${targets.length}):`);
  for (const c of targets) {
    console.log(`  - ${c.name} [${c.id}] type=${c.type} transcode=${c.transcodeStatus || 'none'} size=${(Number(c.sizeBytes) / 1e6).toFixed(1)}MB`);
  }
  if (DRY) { console.log('\n--dry-run: nothing encoded.'); await db.$disconnect(); return; }

  let ok = 0, fail = 0;
  for (const c of targets) { (await processOne(c)) ? ok++ : fail++; }
  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
  console.log('Devices pick up the new renditions on their next plan fetch (changed md5 → re-download).');
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
