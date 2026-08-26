// Nested playlists (SMIL Master → Internal pattern).
//
// A PlaylistItem points at either Content (media) or another Playlist (nested). Playback
// semantics are SMIL <seq>-in-<seq>: a nested playlist plays ALL its items per visit, then
// the parent continues — so the fully-flattened order is the exact play order, which is what
// legacy players receive in `items` while nesting-aware players also get the `nested` tree.
//
// Write-time rules enforced here: exactly one target per item, no self-reference, no cycles,
// max depth (a Master may contain Internals, which may contain Internals — 3 levels total).

import { db } from '@/lib/db';
import { publicUrl } from '@/lib/r2';

export const MAX_NESTING_DEPTH = 3;

export type PlaylistItemInput = {
  contentId?:       string | null;
  childPlaylistId?: string | null;
  durationMs:       number;
};

/**
 * Validates a proposed item list for `playlistId` against the nesting rules.
 * Returns an error string (HTTP 400 material) or null when valid.
 */
export async function validateNesting(
  playlistId: string,
  items: PlaylistItemInput[],
): Promise<string | null> {
  for (const it of items) {
    const hasContent = !!it.contentId;
    const hasChild   = !!it.childPlaylistId;
    if (hasContent === hasChild) {
      return 'each item must set exactly one of contentId or childPlaylistId';
    }
    if (it.childPlaylistId === playlistId) {
      return 'a playlist cannot nest itself';
    }
  }

  const proposedChildren = items
    .map((it) => it.childPlaylistId)
    .filter((id): id is string => !!id);
  if (proposedChildren.length === 0) return null;

  // Adjacency of all nested edges, with this playlist's edges replaced by the proposal.
  const edges = await db.playlistItem.findMany({
    where:  { childPlaylistId: { not: null } },
    select: { playlistId: true, childPlaylistId: true },
  });
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (e.playlistId === playlistId) continue;
    const list = children.get(e.playlistId) ?? [];
    list.push(e.childPlaylistId!);
    children.set(e.playlistId, list);
  }
  children.set(playlistId, proposedChildren);

  // DFS from the edited playlist: any cycle a new edge can create must pass through it,
  // and its subtree depth is what the new edges control.
  const onPath = new Set<string>();
  let tooDeep = false;
  let cyclic  = false;
  const walk = (id: string, depth: number) => {
    if (cyclic || tooDeep) return;
    if (depth > MAX_NESTING_DEPTH) { tooDeep = true; return; }
    if (onPath.has(id)) { cyclic = true; return; }
    onPath.add(id);
    for (const child of children.get(id) ?? []) walk(child, depth + 1);
    onPath.delete(id);
  };
  walk(playlistId, 1);

  if (cyclic)  return 'nesting would create a cycle';
  if (tooDeep) return `nesting exceeds the maximum depth of ${MAX_NESTING_DEPTH} levels`;
  return null;
}

// ── Plan resolution ──────────────────────────────────────────────────────────

/** Media item in the exact wire shape /api/device/plan has always emitted. */
export type PlanMediaItem = {
  contentId:  string;
  objectKey:  string;
  url:        string;
  md5:        string;
  type:       string;
  durationMs: number;
  order:      number;
  hevcUrl:    string | undefined;
  hevcMd5:    string | undefined;
};

export type PlanNestedNode =
  | ({ kind: 'content' } & PlanMediaItem)
  | { kind: 'playlist'; playlistId: string; name: string; items: PlanNestedNode[] };

const PLAN_ITEM_SELECT = {
  durationMs:      true,
  order:           true,
  childPlaylistId: true,
  content: {
    select: {
      id: true, objectKey: true, md5: true, type: true,
      durationMs: true, hevcObjectKey: true, hevcMd5: true,
      originalObjectKey: true, originalMd5: true,
    },
  },
} as const;

type PlanItemRow = {
  durationMs:      number;
  order:           number;
  childPlaylistId: string | null;
  content: {
    id: string; objectKey: string; md5: string; type: string;
    durationMs: number | null; hevcObjectKey: string | null; hevcMd5: string | null;
    originalObjectKey: string | null; originalMd5: string | null;
  } | null;
};

/**
 * Rendition choice for one content row. objectKey holds the safe H.264 rendition once
 * transcoded (the transcode callback overwrites it, as the pipeline always has — which
 * keeps a Vercel rollback to pre-rendition code fleet-safe); original* preserves the
 * full-quality upload. Devices default to objectKey (budget SoCs can't decode hot
 * originals — the reason the transcode pipeline exists); Device.playsOriginal opts a
 * capable panel into the preserved original when one exists.
 */
export function pickRendition(
  c: { objectKey: string; md5: string; originalObjectKey: string | null; originalMd5: string | null },
  safeRendition: boolean,
): { objectKey: string; md5: string } {
  if (!safeRendition && c.originalObjectKey && c.originalMd5) {
    return { objectKey: c.originalObjectKey, md5: c.originalMd5 };
  }
  return { objectKey: c.objectKey, md5: c.md5 };
}

function toMediaItem(row: PlanItemRow, order: number, safeRendition: boolean): PlanMediaItem | null {
  const c = row.content;
  if (!c) return null;
  const chosen = pickRendition(c, safeRendition);
  return {
    contentId:  c.id,
    objectKey:  chosen.objectKey,
    url:        publicUrl(chosen.objectKey),
    md5:        chosen.md5,
    type:       c.type,
    durationMs: row.durationMs,
    order,
    hevcUrl:    c.hevcObjectKey ? publicUrl(c.hevcObjectKey) : undefined,
    hevcMd5:    c.hevcMd5 ?? undefined,
  };
}

/**
 * Resolves a playlist into (a) the nested node tree and (b) the fully-flattened media list
 * in play order. Depth-capped at MAX_NESTING_DEPTH and cycle-safe regardless of what is in
 * the DB (write-time validation should prevent both, but a plan fetch must never 500 or
 * loop on bad data). `flat` item `order` is the position in the flattened sequence, so
 * legacy players play the identical order the nesting-aware sequencer produces.
 */
export async function resolvePlaylistTree(
  playlistId: string,
  opts?: { safeRendition?: boolean },
): Promise<{
  nested: PlanNestedNode[];
  flat:   PlanMediaItem[];
}> {
  // Default to the safe rendition: every caller that doesn't say otherwise is
  // building a manifest some budget panel may end up playing.
  const safeRendition = opts?.safeRendition ?? true;
  const flat: PlanMediaItem[] = [];

  const build = async (id: string, depth: number, path: Set<string>): Promise<PlanNestedNode[]> => {
    if (depth > MAX_NESTING_DEPTH || path.has(id)) return [];
    const playlist = await db.playlist.findUnique({
      where:  { id },
      select: {
        name:  true,
        items: { select: PLAN_ITEM_SELECT, orderBy: { order: 'asc' } },
      },
    });
    if (!playlist) return [];

    const nodes: PlanNestedNode[] = [];
    for (const row of playlist.items as PlanItemRow[]) {
      if (row.childPlaylistId) {
        const child = await db.playlist.findUnique({
          where: { id: row.childPlaylistId }, select: { name: true },
        });
        const childNodes = await build(
          row.childPlaylistId, depth + 1, new Set([...path, id]),
        );
        if (childNodes.length > 0) {
          nodes.push({
            kind: 'playlist',
            playlistId: row.childPlaylistId,
            name: child?.name ?? '',
            items: childNodes,
          });
        }
      } else {
        const item = toMediaItem(row, flat.length, safeRendition);
        if (item) {
          nodes.push({ kind: 'content', ...item });
          flat.push(item);
        }
      }
    }
    return nodes;
  };

  const nested = await build(playlistId, 1, new Set());
  return { nested, flat };
}
