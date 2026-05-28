import { provisionVoice, synthesize } from "@yume/tts-client";
import type {
  BeatAudio,
  Character,
  CharacterVoice,
  Scene,
  Session,
  TtsConfig,
} from "@yume/types";

export type BeatLike = {
  id?: string;
  speaker?: string;
  line?: string;
  lineDelivery?: string;
};

// When the director references a speaker that was never registered, derive a
// description from the name + world so the voice's gender/temperament is at
// least inferred from the name — never borrowed from another character.
function inferredSpeakerDescription(name: string, session: Session): string {
  return `请根据角色名「${name}」推断其性别、年龄与气质，生成最贴合的音色。所属世界观：${session.worldSetting}`;
}

// Voice a single beat against a mutable character registry.
// Returns the (possibly-extended) registry plus the audio if synthesized.
// Narration-only beats and missing-line beats return no audio (VN convention).
export async function voiceBeat(
  cfg: TtsConfig,
  session: Session,
  characters: Character[],
  beat: BeatLike,
): Promise<{ audio?: BeatAudio; characters: Character[] }> {
  if (!beat.speaker || !beat.line) {
    return { characters };
  }

  const speakerName = beat.speaker;
  const text = beat.line;
  const delivery = beat.lineDelivery;

  // Hoisted so the catch can return the in-progress registry even if synthesis
  // fails after provisioning succeeded — otherwise the just-provisioned voice
  // would be lost and the next beat for this speaker would pay to re-design it
  // (extra cost, latency, and more 429 risk on rate-limited providers).
  let nextCharacters: Character[] = characters;

  try {
    const idx = characters.findIndex((c) => c.name === speakerName);
    let voice: CharacterVoice | undefined;

    if (idx !== -1 && characters[idx]?.voice) {
      voice = characters[idx]!.voice;
    } else if (idx !== -1) {
      const target = characters[idx]!;
      voice = await provisionVoice(cfg, target.description);
      nextCharacters = characters.map((c, i) =>
        i === idx ? { ...c, voice } : c,
      );
    } else {
      const description = inferredSpeakerDescription(speakerName, session);
      voice = await provisionVoice(cfg, description);
      nextCharacters = [...characters, { name: speakerName, description, voice }];
    }

    const { audioBase64, mimeType } = await synthesize(
      cfg,
      voice,
      text,
      delivery,
    );
    return {
      audio: { base64: audioBase64, mime: mimeType },
      characters: nextCharacters,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[voice] degraded: ${msg}`);
    return { characters: nextCharacters };
  }
}

// Voice every beat in a scene. Sequential by design: a single speaker
// appearing in multiple beats must provision exactly once and share that
// voice across calls — parallel synthesis would race and create duplicates.
// With 2–6 beats × ~500ms per clone the total cost is well inside the image
// generation budget (10s+), so the simplicity is worth it.
export async function voiceScene(
  cfg: TtsConfig,
  session: Session,
  scene: Scene,
): Promise<{
  beatAudio: Record<string, BeatAudio>;
  characters: Character[];
}> {
  let characters = session.characters;
  const beatAudio: Record<string, BeatAudio> = {};

  for (const beat of scene.beats) {
    const res = await voiceBeat(cfg, session, characters, beat);
    characters = res.characters;
    if (res.audio) beatAudio[beat.id] = res.audio;
  }

  return { beatAudio, characters };
}
