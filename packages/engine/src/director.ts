import { chat } from "@yume/ai-client";
import type {
  Beat,
  BeatChoice,
  BeatChoiceEffect,
  BeatNext,
  Character,
  InsertBeatPartial,
  ProviderConfig,
  Scene,
  Session,
} from "@yume/types";
import { parseJsonLoose } from "./jsonParser";
import {
  DIRECTOR_SYSTEM,
  INSERT_BEAT_SYSTEM,
  buildDirectorUserMessage,
  buildInsertBeatUserMessage,
} from "./prompts";

// ──────────────────────────────────────────────────────────────────────
//  Raw shape produced by the model — we coerce + validate into a Scene.
// ──────────────────────────────────────────────────────────────────────

type RawEffect = {
  kind?: string;
  targetBeatId?: string;
  nextSceneSeed?: string;
};

type RawChoice = {
  id?: string;
  label?: string;
  effect?: RawEffect;
};

type RawNext = {
  type?: string;
  nextBeatId?: string;
  choices?: RawChoice[];
};

type RawBeat = {
  id?: string;
  narration?: string;
  speaker?: string;
  line?: string;
  lineDelivery?: string;
  next?: RawNext;
};

type RawCharacterUpdate = {
  name?: string;
  description?: string;
};

type RawScene = {
  scenePrompt?: string;
  entryBeatId?: string;
  beats?: RawBeat[];
  characterUpdates?: RawCharacterUpdate[];
};

function coerceEffect(raw: RawEffect | undefined): BeatChoiceEffect {
  if (raw?.kind === "advance-beat" && raw.targetBeatId?.trim()) {
    return { kind: "advance-beat", targetBeatId: raw.targetBeatId.trim() };
  }
  return {
    kind: "change-scene",
    nextSceneSeed: raw?.nextSceneSeed?.trim() || "未指定",
  };
}

function coerceChoice(raw: RawChoice, idx: number): BeatChoice {
  return {
    id: raw.id?.trim() || `c${idx + 1}`,
    label: raw.label?.trim() || `选项 ${idx + 1}`,
    effect: coerceEffect(raw.effect),
  };
}

function coerceNext(raw: RawNext | undefined, fallbackBeatId: string): BeatNext {
  if (raw?.type === "choice" && Array.isArray(raw.choices) && raw.choices.length) {
    return {
      type: "choice",
      choices: raw.choices.map((c, i) => coerceChoice(c, i)),
    };
  }
  return {
    type: "continue",
    nextBeatId: raw?.nextBeatId?.trim() || fallbackBeatId,
  };
}

function coerceBeat(raw: RawBeat, idx: number, totalBeats: number): Beat {
  const id = raw.id?.trim() || `b${idx + 1}`;
  // Non-last beats default their `continue` target to the following beat.
  // The last beat gets an empty fallback on purpose: repairBeats() turns a
  // last/dangling continue into a real scene-change exit so the player can
  // never get stuck self-looping on it.
  const fallback = idx + 1 < totalBeats ? `b${idx + 2}` : "";
  const line = raw.line?.trim() || undefined;
  return {
    id,
    narration: raw.narration?.trim() || undefined,
    speaker: raw.speaker?.trim() || undefined,
    line,
    // lineDelivery only meaningful when there is a line to deliver.
    lineDelivery: line ? raw.lineDelivery?.trim() || undefined : undefined,
    next: coerceNext(raw.next, fallback),
  };
}

function coerceCharacterUpdates(raw: RawCharacterUpdate[] | undefined): Character[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      name: c.name?.trim() ?? "",
      description: c.description?.trim() ?? "",
    }))
    .filter((c) => c.name && c.description);
}

const FALLBACK_SEED = "故事继续推进";

function fallbackExitChoice(beatId: string): BeatChoice {
  return {
    id: `${beatId}__exit`,
    label: "继续",
    effect: { kind: "change-scene", nextSceneSeed: FALLBACK_SEED },
  };
}

// Beat ids are graph keys (the front-end's `beats.find(b => b.id === ...)`,
// the session's `visitedBeatIds`, and `continue`/`advance-beat` targets). If
// the model reuses an id across beats, the second occurrence becomes silently
// unreachable and external references collapse to the first beat. Rename
// duplicates; rewrite the renamed beat's OWN self-references (the most
// natural interpretation of a duplicate id being referenced from inside that
// same beat). External references stay pointing at the first occurrence.
function ensureUniqueBeatIds(beats: Beat[]): Beat[] {
  const seen = new Set<string>();
  return beats.map((b): Beat => {
    if (!seen.has(b.id)) {
      seen.add(b.id);
      return b;
    }
    const oldId = b.id;
    let n = 2;
    while (seen.has(`${oldId}_${n}`)) n += 1;
    const newId = `${oldId}_${n}`;
    seen.add(newId);

    let next = b.next;
    if (next.type === "continue" && next.nextBeatId === oldId) {
      next = { type: "continue", nextBeatId: newId };
    } else if (next.type === "choice") {
      next = {
        type: "choice",
        choices: next.choices.map((c) =>
          c.effect.kind === "advance-beat" && c.effect.targetBeatId === oldId
            ? {
                ...c,
                effect: { kind: "advance-beat" as const, targetBeatId: newId },
              }
            : c,
        ),
      };
    }
    return { ...b, id: newId, next };
  });
}

// Repairs referential integrity AND guarantees the scene is escapable:
// - a `continue` to a missing/self id is repointed to the next beat in order;
//   a last/dangling continue with nowhere to go becomes a scene-change exit
//   (never a self-loop, which would strand the player on "click to advance")
// - an `advance-beat` to a missing id is downgraded to a scene change
// - if no change-scene exit exists anywhere, one is appended to the last beat
function repairBeats(beats: Beat[]): Beat[] {
  const ids = new Set(beats.map((b) => b.id));

  const fixed: Beat[] = beats.map((b, idx): Beat => {
    if (b.next.type === "continue") {
      const target = b.next.nextBeatId;
      if (ids.has(target) && target !== b.id) return b;
      const nextByIndex = beats[idx + 1]?.id;
      if (nextByIndex) {
        return { ...b, next: { type: "continue", nextBeatId: nextByIndex } };
      }
      return { ...b, next: { type: "choice", choices: [fallbackExitChoice(b.id)] } };
    }

    const patched = b.next.choices.map((c) =>
      c.effect.kind === "advance-beat" && !ids.has(c.effect.targetBeatId)
        ? {
            ...c,
            effect: {
              kind: "change-scene" as const,
              nextSceneSeed: "未指定（导演引用不存在的 beat，已降级为换场）",
            },
          }
        : c,
    );
    return { ...b, next: { type: "choice", choices: patched } };
  });

  const hasExit = fixed.some(
    (b) =>
      b.next.type === "choice" &&
      b.next.choices.some((c) => c.effect.kind === "change-scene"),
  );
  if (!hasExit && fixed.length > 0) {
    const lastIdx = fixed.length - 1;
    const last = fixed[lastIdx]!;
    const existing = last.next.type === "choice" ? last.next.choices : [];
    fixed[lastIdx] = {
      ...last,
      next: { type: "choice", choices: [...existing, fallbackExitChoice(last.id)] },
    };
  }

  return fixed;
}

// Choice ids are the keys the front-end uses to cache and consume prefetched
// scenes. Two beats both defaulting to c1/c2 (or the model reusing ids across
// beats) would make a transition reuse the WRONG prefetched scene — so force
// every choice id to be unique within the scene.
function ensureUniqueChoiceIds(beats: Beat[]): Beat[] {
  const seen = new Set<string>();
  for (const b of beats) {
    if (b.next.type !== "choice") continue;
    for (const c of b.next.choices) {
      if (seen.has(c.id)) {
        let n = 2;
        while (seen.has(`${c.id}_${n}`)) n += 1;
        c.id = `${c.id}_${n}`;
      }
      seen.add(c.id);
    }
  }
  return beats;
}

function newSceneId(): string {
  return `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ──────────────────────────────────────────────────────────────────────
//  directScene — generates one Scene (multi-beat) for the player.
//  Called both on real scene transitions AND on speculative prefetch.
// ──────────────────────────────────────────────────────────────────────

export type SceneResult = {
  scene: Scene;
  characterUpdates: Character[];
};

export async function directScene(
  config: ProviderConfig,
  session: Session,
): Promise<SceneResult> {
  const raw = await chat(
    config,
    [
      { role: "system", content: DIRECTOR_SYSTEM },
      { role: "user", content: buildDirectorUserMessage(session) },
    ],
    { temperature: 0.9, responseFormat: "json_object" },
  );

  const parsed = parseJsonLoose<RawScene>(raw);
  const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : [];
  if (rawBeats.length === 0) {
    throw new Error("Director returned no beats");
  }

  const beats = ensureUniqueChoiceIds(
    repairBeats(
      ensureUniqueBeatIds(
        rawBeats.map((b, i) => coerceBeat(b, i, rawBeats.length)),
      ),
    ),
  );

  const declaredEntry = parsed.entryBeatId?.trim();
  const entryBeatId =
    declaredEntry && beats.some((b) => b.id === declaredEntry)
      ? declaredEntry
      : beats[0]!.id;

  return {
    scene: {
      id: newSceneId(),
      scenePrompt: parsed.scenePrompt?.trim() || "an empty scene",
      beats,
      entryBeatId,
    },
    characterUpdates: coerceCharacterUpdates(parsed.characterUpdates),
  };
}

// ──────────────────────────────────────────────────────────────────────
//  directInsertBeat — generates a one-off transient beat in response to
//  a freeform vision action that stays in-scene. Used by /api/insert-beat.
// ──────────────────────────────────────────────────────────────────────

export async function directInsertBeat(
  config: ProviderConfig,
  session: Session,
  freeformAction: string,
): Promise<InsertBeatPartial> {
  const raw = await chat(
    config,
    [
      { role: "system", content: INSERT_BEAT_SYSTEM },
      {
        role: "user",
        content: buildInsertBeatUserMessage(session, freeformAction),
      },
    ],
    { temperature: 0.9, responseFormat: "json_object" },
  );

  const parsed = parseJsonLoose<InsertBeatPartial>(raw);

  const narration = parsed.narration?.trim() || undefined;
  const speaker = parsed.speaker?.trim() || undefined;
  const line = parsed.line?.trim() || undefined;
  const lineDelivery = line ? parsed.lineDelivery?.trim() || undefined : undefined;

  // If the model returned nothing usable, supply a fallback narration so the
  // frontend doesn't append a silent empty beat that renders no dialogue —
  // which would make the click appear to do nothing.
  if (!narration && !speaker && !line) {
    return { narration: "（你停下脚步，环视片刻。）" };
  }
  return { narration, speaker, line, lineDelivery };
}
