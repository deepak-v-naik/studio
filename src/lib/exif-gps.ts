// Minimal client-side EXIF GPS extractor for JPEG files.
//
// Why hand-rolled: the onboarding photo gates need the coordinates embedded by
// GPS-camera apps, but canvas re-encoding (used to shrink >4 MB photos under
// the Vercel body cap) strips EXIF — so coordinates must be read from the
// ORIGINAL file bytes before any compression. A full EXIF library is overkill
// for four GPS tags. Non-JPEG files (e.g. iPhone HEIC) simply return null and
// the caller falls back to the device's geolocation.

export type GpsFix = { lat: number; lng: number };

/** Reads GPS coordinates from a JPEG's EXIF, or null if absent/unparseable. */
export async function extractGpsFromFile(file: File): Promise<GpsFix | null> {
  try {
    // EXIF APP1 sits in the first bytes of the file; 256 KB is far more than
    // any real header while keeping memory use trivial.
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    return extractGpsFromJpeg(new DataView(buf));
  } catch {
    return null;
  }
}

function extractGpsFromJpeg(view: DataView): GpsFix | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG

  // Walk JPEG segments looking for APP1/Exif
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    // JPEG allows 0xFF fill bytes between segments — skip padding so the
    // marker and size are read from the right position.
    while (offset + 4 <= view.byteLength && view.getUint8(offset + 1) === 0xff) offset++;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda) return null; // start of scan — no EXIF found
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1 && offset + 10 <= view.byteLength) {
      // "Exif\0\0"
      if (
        view.getUint32(offset + 4) === 0x45786966 &&
        view.getUint16(offset + 8) === 0x0000
      ) {
        return parseTiffForGps(view, offset + 10, size - 8);
      }
    }
    offset += 2 + size;
  }
  return null;
}

function parseTiffForGps(view: DataView, tiffStart: number, tiffLen: number): GpsFix | null {
  if (tiffLen < 8 || tiffStart + tiffLen > view.byteLength) return null;

  const endian = view.getUint16(tiffStart);
  const little = endian === 0x4949; // 'II'
  if (!little && endian !== 0x4d4d) return null; // 'MM'

  const u16 = (o: number) => view.getUint16(tiffStart + o, little);
  const u32 = (o: number) => view.getUint32(tiffStart + o, little);

  if (u16(2) !== 0x002a) return null;
  const ifd0 = u32(4);

  // Find the GPS IFD pointer (tag 0x8825) in IFD0
  const gpsIfdOffset = findTagValue(view, tiffStart, tiffLen, ifd0, 0x8825, little);
  if (gpsIfdOffset == null) return null;

  // GPS IFD tags: 1 = LatRef ('N'/'S'), 2 = Lat (3 rationals),
  //               3 = LngRef ('E'/'W'), 4 = Lng (3 rationals)
  const count = safeU16(view, tiffStart, tiffLen, gpsIfdOffset, little);
  if (count == null) return null;

  let latRef: string | null = null, lngRef: string | null = null;
  let lat: number | null = null, lng: number | null = null;

  for (let i = 0; i < count; i++) {
    const entry = gpsIfdOffset + 2 + i * 12;
    if (entry + 12 > tiffLen) break;
    const tag = u16(entry);
    if (tag === 0x0001 || tag === 0x0003) {
      // ASCII ref, count ≤ 4 → value inlined in the entry
      const ch = String.fromCharCode(view.getUint8(tiffStart + entry + 8));
      if (tag === 0x0001) latRef = ch; else lngRef = ch;
    } else if (tag === 0x0002 || tag === 0x0004) {
      // 3 RATIONALs (24 bytes) → value is at a pointer
      const valOff = u32(entry + 8);
      if (valOff + 24 > tiffLen) continue;
      const dms: number[] = [];
      for (let r = 0; r < 3; r++) {
        const num = u32(valOff + r * 8);
        const den = u32(valOff + r * 8 + 4);
        dms.push(den === 0 ? 0 : num / den);
      }
      const dec = dms[0] + dms[1] / 60 + dms[2] / 3600;
      if (tag === 0x0002) lat = dec; else lng = dec;
    }
  }

  if (lat == null || lng == null) return null;
  if (latRef === 'S') lat = -lat;
  if (lngRef === 'W') lng = -lng;
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function findTagValue(
  view: DataView, tiffStart: number, tiffLen: number,
  ifdOffset: number, wantedTag: number, little: boolean,
): number | null {
  const count = safeU16(view, tiffStart, tiffLen, ifdOffset, little);
  if (count == null) return null;
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > tiffLen) break;
    if (view.getUint16(tiffStart + entry, little) === wantedTag) {
      return view.getUint32(tiffStart + entry + 8, little);
    }
  }
  return null;
}

function safeU16(
  view: DataView, tiffStart: number, tiffLen: number, offset: number, little: boolean,
): number | null {
  if (offset < 0 || offset + 2 > tiffLen) return null;
  return view.getUint16(tiffStart + offset, little);
}
