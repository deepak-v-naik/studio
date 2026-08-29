#!/usr/bin/env node
// Regenerates public/icons/* from vector sources. Run: node scripts/generate-icons.mjs
//
// The mark is the ALIVE dot (same motif as public/favicon.svg), NOT the "alive"
// wordmark: the wordmark is Poppins ExtraBold, which isn't guaranteed on any
// machine that runs this, and a fallback face renders visibly off-brand. The dot
// is font-free, so output is identical everywhere — and it stays legible at the
// ~24dp Android draws a notification icon at, where a wordmark turns to mush.
//
// Two families:
//   any      — white background + red dot. Home screen, and the notification's
//              large icon, where the OS shows the image as-is.
//   maskable — red bleeding to all four edges + white dot well inside the safe
//              zone (Android crops adaptive icons to a circle/squircle; a white
//              background would get its corners clipped and look broken).
// The badge is white-on-transparent because Android alpha-masks it to a
// silhouette — any colour there is discarded.

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const RED = '#ef4444'; // theme_color in src/app/manifest.ts

/** White field, red dot. `r` is the dot radius as a fraction of the canvas. */
const anySvg = (size, r = 0.23) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ffffff"/>
  <circle cx="50" cy="50" r="${r * 100}" fill="${RED}"/>
</svg>`;

/** Red field bleeding to the edges, white dot inside the maskable safe zone. */
const maskableSvg = (size, r = 0.17) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${RED}"/>
  <circle cx="50" cy="50" r="${r * 100}" fill="#ffffff"/>
</svg>`;

/** Monochrome silhouette on transparent — Android discards colour here. */
const badgeSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="34" fill="#ffffff"/>
</svg>`;

const FILES = [
  ['icon-192.png',          anySvg(192)],
  ['icon-512.png',          anySvg(512)],
  ['icon-maskable-192.png', maskableSvg(192)],
  ['icon-maskable-512.png', maskableSvg(512)],
  // iOS composites onto black if the icon has alpha, so this one stays opaque.
  ['apple-touch-icon.png',  anySvg(180)],
  ['badge-96.png',          badgeSvg(96)],
];

await mkdir(OUT, { recursive: true });

for (const [name, svg] of FILES) {
  const buf = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(OUT, name), buf);
  const { width, height, channels } = await sharp(buf).metadata();
  console.log(`  ${name.padEnd(24)} ${width}x${height}  ${channels}ch  ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log(`\nWrote ${FILES.length} icons to public/icons/`);
