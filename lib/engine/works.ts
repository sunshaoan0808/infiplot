/**
 * W10: Works catalog — the list of available story works/presets.
 *
 * Each work has a unique id, metadata, and a `worldSetting` + `styleGuide`
 * that the engine uses as the session's creative foundation. Works are
 * defined in `lib/presets.ts` and served here as a read-only API.
 */

import { PRESETS, type Preset } from "../presets.ts";

export type WorkInfo = {
  id: string;
  title: string;
  blurb: string;
  worldSetting: string;
  styleGuide: string;
};

/**
 * Resolve a workId to its preset. Returns the full WorkInfo or null.
 * When `workId` is absent, returns null (caller falls back to freeform).
 */
export function getWork(workId?: string): WorkInfo | null {
  if (!workId) return null;
  const preset = PRESETS.find((p) => p.id === workId);
  if (!preset) return null;
  return {
    id: preset.id,
    title: preset.title,
    blurb: preset.blurb,
    worldSetting: preset.worldSetting,
    styleGuide: preset.styleGuide,
  };
}

/**
 * List all available works (for the works catalog page).
 */
export function listWorks(): WorkInfo[] {
  return PRESETS.map((p) => ({
    id: p.id,
    title: p.title,
    blurb: p.blurb,
    worldSetting: p.worldSetting,
    styleGuide: p.styleGuide,
  }));
}

export type { Preset };