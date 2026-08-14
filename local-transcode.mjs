#!/usr/bin/env node
// Local, operator-run equivalent of the transcode Lambda (transcode-lambda/index.mjs).
// Use it when you want to re-encode content WITHOUT redeploying the Lambda — it does the
// exact same thing on your machine and leaves the Content row in the identical end-state
// the Lambda's callback would (objectKey/md5/sizeBytes/durationMs/width/height + optional
// HEVC rendition, transcodeStatus='done').
//
// Requirements on the machine you run this from:
//   - ffmpeg + ffprobe on PATH, built with libx264 AND libx265
//   - Run from the studio/ directory so node resolves @aws-sdk/client-s3, @prisma/client,
//     dotenv from studio/node_modules
//   - REAL R2 creds in .env.production.local (or .env.local): R2_ENDPOINT, R2_ACCESS_KEY_ID,
//     R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE, and DATABASE_URL. (In the Claude
//     sandbox these come through redacted as "[SENSITIVE]", which is why this must be run
//     by you, not the agent.)
//
// Usage:
//   node local-transcode.mjs <contentId> [<contentId> ...]     # specific content rows
//   node local-transcode.mjs --playlist "custom android"        # every video in a playlist (name contains)
//   node local-transcode.mjs --all-pending                      # every video not yet transcoded (transcodeStatus != 'done')
//   node local-transcode.mjs --playlist "x" --dry-run           # list targets, encode nothing
//   node local-transcode.mjs --playlist "x" --no-hevc           # skip the HEVC rendition
//
// Safety: mutates PRODUCTION content + R2. Each row is set transcodeStatus='pending' before
// and 'done'/'error' after, exactly like the pipeline. The original object is NOT deleted
// (a NEW key is written), so a device mid-download is unaffected and you can roll back by
// restoring the old objectKey/md5 if needed.

import 'dotenv/config';
import dotenv from 'dotenv';
import { randomUUID, createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

// Load real creds. .env.production.local wins (Vercel-pulled prod values), then .env.local.
dotenv.config({ path: '.env.production.local' });
dotenv.config({ path: '.env.local' });

const run = promisify(execFile);
const db = new PrismaClient();

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
  const need = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE', 'DATABASE_URL'];
  const missing = need.filter((k) => !process.env[k] || process.env[k] === '[SENSITIVE]');
  if (missing.length) {
    die(`These env vars are missing or redacted to [SENSITIVE]: ${missing.join(', ')}\n` +
        `  Run this in a shell where .env.production.local holds the REAL values (not the Claude sandbox).`);
  }
}

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function publicUrl(objectKey) {
  return process.env.R2_PUBLIC_BASE.replace(/\/+$/, '') + '/' + objectKey.replace(/^\/+/, '');
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
    // de-dupe by content id; videos only
    const seen = new Map();
    for (const it of items) if (it.content && it.content.type === 'VIDEO') seen.set(it.content.id, it.content);
    return [...seen.values()];
  }
  if (allPending) {
    return db.content.findMany({ where: { type: 'VIDEO', NOT: { transcodeStatus: 'done' } } });
  }
  die('Nothing selected. Pass content ids, or --playlist "<name>", or --all-pending. (--dry-run to preview.)');
}

async function ffmpegH264(inFile, outFile) {
  await run('ffmpeg', [
    '-y', '-i', inFile,
    '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease",
    '-r', '30', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    outFile,
  ], { maxBuffer: 1 << 26 });
}

async function ffmpegHevc(inFile, outFile) {
  await run('ffmpeg', [
    '-y', '-i', inFile,
    '-c:v', 'libx265', '-tag:v', 'hvc1', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease",
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
  const src = publicUrl(c.objectKey);
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
    await r2Client().send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: objectKey, Body: outBytes, ContentType: 'video/mp4',
    }));
    console.log(`  ✓ H.264 ${width}x${height} ${(outBytes.length / 1e6).toFixed(1)}MB → ${objectKey}`);

    // 3. HEVC (best-effort)
    let hevc = {};
    if (!NO_HEVC) {
      try {
        console.log('  encoding HEVC (best-effort)…');
        await ffmpegHevc(tmpIn, tmpHevc);
        const hb = await readFile(tmpHevc);
        const hevcObjectKey = `content/${c.id}-transcoded-hevc-${Date.now()}.mp4`;
        await r2Client().send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET, Key: hevcObjectKey, Body: hb, ContentType: 'video/mp4',
        }));
        hevc = { hevcObjectKey, hevcMd5: createHash('md5').update(hb).digest('hex'), hevcSizeBytes: BigInt(hb.length) };
        console.log(`  ✓ HEVC ${(hb.length / 1e6).toFixed(1)}MB → ${hevcObjectKey}`);
      } catch (e) {
        console.warn(`  ! HEVC failed (non-fatal): ${e.message}`);
      }
    }

    // 4. update Content row — same fields the transcode-callback route writes
    await db.content.update({
      where: { id: c.id },
      data: {
        objectKey, md5, sizeBytes: BigInt(outBytes.length),
        durationMs: durationMs ?? undefined, width: width ?? undefined, height: height ?? undefined,
        transcodeStatus: 'done', transcodeError: null, ...hevc,
      },
    });
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

main().catch(async (e) => { console.error(e); await db.$disconnect().catch(() => {}); process.exit(1); });
