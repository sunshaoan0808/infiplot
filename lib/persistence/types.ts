// Persistence wire types — local-first story storage.
//
// Shared shapes for the browser-local store (IndexedDB) and the future Supabase
// cloud store. Replaces the deleted D1 `lib/db/repositories/storyRepo` types,
// severing all dependency on Drizzle / D1. The local `StoryRecord` and the cloud
// `public.stories` row both carry the same slim `Session` blob (see
// `SlimStoryBlob`) so there is no dual data shape to reconcile when cloud sync
// is layered on next phase.

import type { Session, Orientation } from "@infiplot/types";

/** Schema version stamped on every local record — migration hook for future
 *  structural evolution of `StoryRecord`. Bump when the on-disk shape changes. */
export const STORY_SCHEMA_VERSION = 1;

/** Coerce a Date | string | number (or anything) to epoch milliseconds, falling
 *  back when the value is unparseable. Shared by the local store, the cloud
 *  store (Supabase timestamptz), and the stories list UI — every site where a
 *  timestamp crosses a storage/serialization boundary and could arrive as a
 *  non-number, guarding against the historical `t.getTime is not a function`
 *  white-screen. */
export function coerceEpoch(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  // Number.isFinite (not just !isNaN) so ±Infinity also falls through to the
  // fallback — new Date(Infinity).getTime() is NaN, not a usable epoch.
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const d = value instanceof Date ? value : new Date(value as string | number);
  const t = d.getTime();
  return Number.isFinite(t) ? t : fallback;
}

// ── Corrupt-save validation ───────────────────────────────────────────────

export type SessionValidationError =
  | { kind: "missing_id" }
  | { kind: "missing_history" }
  | { kind: "empty_history" }
  | { kind: "missing_scene"; sceneIndex: number }
  | { kind: "missing_image"; sceneIndex: number }
  | { kind: "missing_entry_beat"; sceneIndex: number }
  | { kind: "missing_beats"; sceneIndex: number }
  | { kind: "story_state_missing" };

/** Validate a loaded Session for structural integrity. Returns null when the
 *  session is usable, or a structured error describing what's wrong so callers
 *  can surface a human-readable recovery message instead of a white screen. */
export function validateSession(session: unknown): SessionValidationError | null {
  if (!session || typeof session !== "object") {
    return { kind: "missing_id" };
  }
  const s = session as Record<string, unknown>;

  if (!s.id || typeof s.id !== "string") {
    return { kind: "missing_id" };
  }

  if (!Array.isArray(s.history)) {
    return { kind: "missing_history" };
  }

  if (s.history.length === 0) {
    return { kind: "empty_history" };
  }

  for (let i = 0; i < s.history.length; i++) {
    const entry = s.history[i] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") {
      return { kind: "missing_scene", sceneIndex: i };
    }
    const scene = entry.scene as Record<string, unknown> | undefined;
    if (!scene || typeof scene !== "object") {
      return { kind: "missing_scene", sceneIndex: i };
    }
    if (!scene.imageUrl && !scene.imageUuid) {
      // Last scene without image is acceptable (we can rewind), but log it.
      // Earlier scenes without images indicate corruption.
      if (i < s.history.length - 1) {
        return { kind: "missing_image", sceneIndex: i };
      }
    }
    if (!scene.entryBeatId || typeof scene.entryBeatId !== "string") {
      return { kind: "missing_entry_beat", sceneIndex: i };
    }
    if (!Array.isArray(scene.beats) || scene.beats.length === 0) {
      return { kind: "missing_beats", sceneIndex: i };
    }
  }

  // storyState is optional for back-compat but recommended
  if (s.storyState && typeof s.storyState === "object") {
    const ws = s.storyState as Record<string, unknown>;
    if (!ws.logline || !ws.synopsis) {
      return { kind: "story_state_missing" };
    }
  }

  return null;
}

/** Return a human-readable recovery message for a session validation error.
 *  Used by the play page to surface actionable info instead of a crash. */
export function sessionValidationErrorLabel(err: SessionValidationError): string {
  switch (err.kind) {
    case "missing_id":
      return "存档缺少会话 ID，无法恢复";
    case "missing_history":
      return "存档缺少剧情历史记录";
    case "empty_history":
      return "存档的历史记录为空，无场景可恢复";
    case "missing_scene":
      return `存档第 ${err.sceneIndex + 1} 个场景数据损坏`;
    case "missing_image":
      return `存档第 ${err.sceneIndex + 1} 个场景缺少图片，无法渲染`;
    case "missing_entry_beat":
      return `存档第 ${err.sceneIndex + 1} 个场景缺少起始节点`;
    case "missing_beats":
      return `存档第 ${err.sceneIndex + 1} 个场景缺少对话数据`;
    case "story_state_missing":
      return "存档缺少剧情状态（可继续，但可能影响后续生成质量）";
  }
}

/** local-first sync state of a record.
 *  - "local-only": never sent to the cloud (open-source default, or pre-sync).
 *  - "synced":     in agreement with the cloud row.
 *  - "pending":    has un-propagated local changes (incl. soft-delete tombstones). */
export type SyncState = "local-only" | "synced" | "pending";

/** List-view projection of a saved story — the lightweight metadata the
 *  "我的剧情" page renders without parsing the full session blob. Migrated out of
 *  the deleted D1 `storyRepo`; timestamps are unified to epoch milliseconds
 *  (the old D1 shape used `Date` and carried `userId`/`status`, both dropped:
 *  the local layer has no account concept, and `status` was a D1 leftover). */
export type StoryMeta = {
  id: string;
  worldSetting: string;
  styleGuide: string;
  orientation: Orientation;
  sceneCount: number;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
};

/** The shared core payload for one saved story, identical between the local
 *  record and the (future) cloud row. `session` is the SLIM `Session` — the
 *  bulky reconstructible fields (`voice.referenceAudioBase64`,
 *  `styleReferenceImage`) are stripped before persistence by the store layer. */
export type SlimStoryBlob = {
  id: string;
  worldSetting: string;
  styleGuide: string;
  orientation: Orientation;
  sceneCount: number;
  rev: number;
  /** Slim Session (voice + styleReferenceImage stripped). Type stays `Session`;
   *  slimming is a runtime guarantee enforced by the store, not the type. */
  session: Session;
};

/** One row in the browser-local IndexedDB store (object store keyPath = "id").
 *  Carries the slim session payload plus the local-first sync-reserved
 *  metadata so cloud sync can be layered on next phase without restructuring. */
export type StoryRecord = {
  id: string;
  /** = STORY_SCHEMA_VERSION at write time. */
  schemaVersion: number;

  // ── List-view metadata (denormalized so listing needn't parse the blob) ──
  worldSetting: string;
  styleGuide: string;
  orientation: Orientation;
  sceneCount: number;

  // ── local-first sync-reserved fields ──
  /** epoch ms; set on first save, preserved across subsequent upserts. */
  createdAt: number;
  /** epoch ms; refreshed on every save. */
  updatedAt: number;
  /** Revision counter; new record = 1, bumped on each local save. */
  rev: number;
  /** Soft-delete tombstone (epoch ms) or null. Delete sets this rather than
   *  physically removing the row, so the deletion can propagate to the cloud
   *  next phase. List queries filter tombstoned records out. */
  deletedAt: number | null;
  syncState: SyncState;

  // ── Payload ──
  /** Slim Session (voice + styleReferenceImage stripped). IndexedDB
   *  structured-clones objects, so this is stored as-is (no JSON.stringify). */
  session: Session;
};

// ── Cloud-sync wire types (story-cloud-sync) ────────────────────────────────

/** Manifest projection of one cloud story — the lightweight metadata the
 *  reconcile engine diffs against the local set. Unlike `StoryMeta` it CARRIES
 *  the tombstone (`deletedAt`) and `rev`, because reconcile needs both to pick
 *  a winner (rev → updatedAt last-write-wins) and to propagate soft-deletes.
 *  Never carries the session blob — the manifest is the cheap diff basis. */
export type StorySyncMeta = {
  id: string;
  rev: number;
  /** epoch ms */
  updatedAt: number;
  /** Soft-delete tombstone (epoch ms) or null. */
  deletedAt: number | null;
};

/** Full-payload carrier for pull/push between the local store and the cloud.
 *  Extends the shared `SlimStoryBlob` with the two sync-ordering fields:
 *   - `updatedAt` is the CLIENT-recorded modification time (NOT a server
 *     `now()`), so when two devices collide on the same `rev`, `updatedAt`
 *     stays a meaningful last-write-wins tiebreaker rather than always-now.
 *   - `deletedAt` lets a tombstone ride the same envelope (delete propagation).
 *  `rev` is already on `SlimStoryBlob`, so the envelope = blob + (updatedAt,
 *  deletedAt). This is the single shape crossing the API at pull/push. */
export type StorySyncEnvelope = SlimStoryBlob & {
  /** epoch ms */
  updatedAt: number;
  /** Soft-delete tombstone (epoch ms) or null. */
  deletedAt: number | null;
};
