import type {
  BeatAudio,
  Character,
  EngineConfig,
  InsertBeatRequest,
  InsertBeatResponse,
  Scene,
  SceneRequest,
  SceneResponse,
  Session,
  StartRequest,
  StartResponse,
  VisionRequest,
  VisionResponse,
} from "@yume/types";
import { annotateClick } from "./annotate";
import { directInsertBeat, directScene } from "./director";
import { mockImageBase64 } from "./mockImage";
import { render } from "./renderer";
import { interpret } from "./vision";
import { voiceBeat, voiceScene } from "./voice";

function newSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Merge new character entries into the registry by name. If a name already
// exists we preserve the existing voice (so a description revision never
// silently re-provisions a voice the player has already heard).
function mergeCharacters(existing: Character[], updates: Character[]): Character[] {
  if (updates.length === 0) return existing;
  const byName = new Map(existing.map((c) => [c.name, c]));
  for (const u of updates) {
    const prev = byName.get(u.name);
    byName.set(u.name, prev?.voice ? { ...u, voice: prev.voice } : u);
  }
  return Array.from(byName.values());
}

async function renderImage(
  config: EngineConfig,
  scene: Scene,
  styleGuide: string,
): Promise<string> {
  if (config.mockImage) return mockImageBase64();
  return render(config.image, scene, styleGuide);
}

async function runVoiceScene(
  config: EngineConfig,
  session: Session,
  scene: Scene,
): Promise<{
  beatAudio?: Record<string, BeatAudio>;
  characters: Character[];
}> {
  if (!config.tts) return { characters: session.characters };
  const res = await voiceScene(config.tts, session, scene);
  return {
    beatAudio: Object.keys(res.beatAudio).length ? res.beatAudio : undefined,
    characters: res.characters,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  startSession — first scene + image + per-beat voice
// ──────────────────────────────────────────────────────────────────────

export async function startSession(
  config: EngineConfig,
  req: StartRequest,
): Promise<StartResponse> {
  const session: Session = {
    id: newSessionId(),
    createdAt: Date.now(),
    worldSetting: req.worldSetting.trim(),
    styleGuide: req.styleGuide.trim(),
    history: [],
    characters: [],
  };

  const { scene, characterUpdates } = await directScene(config.text, session);
  const preVoiceSession: Session = {
    ...session,
    characters: mergeCharacters(session.characters, characterUpdates),
  };

  const [imageBase64, voiceRes] = await Promise.all([
    renderImage(config, scene, preVoiceSession.styleGuide),
    runVoiceScene(config, preVoiceSession, scene),
  ]);

  return {
    sessionId: session.id,
    scene,
    imageBase64,
    characters: voiceRes.characters,
    beatAudio: voiceRes.beatAudio,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  requestScene — generate the NEXT scene + image + per-beat voice.
//  Used both on real scene transitions and on speculative prefetch.
// ──────────────────────────────────────────────────────────────────────

export async function requestScene(
  config: EngineConfig,
  req: SceneRequest,
): Promise<SceneResponse> {
  const { scene, characterUpdates } = await directScene(config.text, req.session);
  const preVoiceSession: Session = {
    ...req.session,
    characters: mergeCharacters(req.session.characters, characterUpdates),
  };

  const [imageBase64, voiceRes] = await Promise.all([
    renderImage(config, scene, preVoiceSession.styleGuide),
    runVoiceScene(config, preVoiceSession, scene),
  ]);

  return {
    scene,
    imageBase64,
    characters: voiceRes.characters,
    beatAudio: voiceRes.beatAudio,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  visionDecide — interprets a background click into intent + classify.
// ──────────────────────────────────────────────────────────────────────

export async function visionDecide(
  config: EngineConfig,
  req: VisionRequest,
): Promise<VisionResponse> {
  const annotated = await annotateClick(req.prevImageBase64, req.click);
  const current = req.session.history.at(-1)?.scene ?? null;
  return interpret(config.vision, annotated, current);
}

// ──────────────────────────────────────────────────────────────────────
//  requestInsertBeat — generates a transient in-scene beat (no image regen)
//  and voices the line if any.
// ──────────────────────────────────────────────────────────────────────

export async function requestInsertBeat(
  config: EngineConfig,
  req: InsertBeatRequest,
): Promise<InsertBeatResponse> {
  const partial = await directInsertBeat(
    config.text,
    req.session,
    req.freeformAction,
  );

  // INSERT_BEAT prompt forbids new characters — but if the director violates
  // it, voiceBeat's name-inferred fallback would silently provision and persist
  // the hallucinated speaker. Strip the speaker attribution and promote the
  // line into narration so the player still sees the text (the client only
  // renders `line` when there is a `speaker`).
  if (
    partial.speaker &&
    !req.session.characters.some((c) => c.name === partial.speaker)
  ) {
    console.warn(
      `[insert-beat] unregistered speaker "${partial.speaker}" ignored`,
    );
    const promotedNarration =
      [partial.narration, partial.line].filter(Boolean).join("\n") || undefined;
    return {
      partial: {
        narration: promotedNarration,
        speaker: undefined,
        line: undefined,
        lineDelivery: undefined,
      },
      characters: req.session.characters,
    };
  }

  if (!config.tts) {
    // Always echo characters so callers don't need a ?? fallback.
    return { partial, characters: req.session.characters };
  }

  // Insert beats stay in-scene and (per the INSERT_BEAT prompt) reuse the
  // registered cast, so we voice against the existing character set.
  const voiceRes = await voiceBeat(
    config.tts,
    req.session,
    req.session.characters,
    partial,
  );

  return {
    partial,
    characters: voiceRes.characters,
    audio: voiceRes.audio,
  };
}
