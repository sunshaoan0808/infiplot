import { generateImage } from "@infiplot/ai-client";
import type { GenerateImageOptions, GenerateImageResult } from "@infiplot/ai-client";
import type {
  Beat,
  Character,
  EngineConfig,
  Orientation,
  ProviderConfig,
} from "@infiplot/types";
import { mockImageDataUri } from "../mockImage";
import { buildPainterPrompt } from "../prompts";
import { recordSla, type ImageSlaResult } from "../imageSla";

// ──────────────────────────────────────────────────────────────────────
//  Painter — final image generation with multi-reference anchoring.
//
//  FLUX.2 [klein] 9B KV does NOT support seedImage (img2img). Instead,
//  visual continuity comes entirely from `referenceImages` (capped at 4),
//  which the KV-optimized variant accelerates ~2.5× via key-value caching
//  of reference latents.
//
//  References are slotted in priority order (max 4):
//    1. Prior scene image — when sceneKey matched a previous scene, this
//       anchors the same physical space (lighting/layout/style continuity)
//    2. Entry beat's speaker portrait — the NPC the player is talking with
//       (most visually prominent)
//    3. Other on-stage NPCs' portraits — secondary characters in the frame
//
//  References are sent as UUIDs (preferred — cheapest in transport) or URLs
//  (fallback — still cheaper than base64). Base64 fallback was removed when
//  generateImage switched to outputType=URL, which always returns both a UUID
//  and a URL so we never lack a cheap reference handle.
//
//  Failure handling — two-tier degradation:
//    A. referenceImages call           (preferred — full visual anchoring)
//    B. pure text-to-image fallback    (last resort if Runware refs API errors)
//
//  W8: provider failover chain
//    primary → backup → mock (double failure → no image, game continues)
//    Each attempt recorded in SLA ledger.
// ──────────────────────────────────────────────────────────────────────

const MAX_REFERENCE_IMAGES = 4;

export type PainterInput = {
  integratedPrompt: string;
  styleGuide: string;
  onStageCharacters: Character[];
  priorSceneImage?: string;
  styleReferenceImage?: string;
  orientation?: Orientation;
};

export type PainterResult =
  | { kind: "real"; imageUrl: string; imageUuid: string }
  | { kind: "mock"; imageUrl: string };

// Pick the references we send to Runware as `referenceImages`. Priority:
//   slot 0: priorSceneImage (if any — sceneKey continuity)
//   slot 1: entry beat's speaker portrait (the NPC speaking to the player)
//   slot 2+: other on-stage NPCs from entry beat's activeCharacters
// Caps at 4 total. Returns the array exactly as it'll be sent — already
// truncated, already deduplicated.
export function collectReferenceImages(
  characters: Character[],
  entryBeat: Beat | undefined,
  priorSceneImage: string | undefined,
  styleReferenceImage?: string,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  if (styleReferenceImage) {
    refs.push(styleReferenceImage);
  }

  if (priorSceneImage) {
    refs.push(priorSceneImage);
  }

  const speakerName = entryBeat?.speaker;
  if (speakerName) {
    const speaker = characters.find((c) => c.name === speakerName);
    const ref = speaker?.basePortraitUrl ?? speaker?.basePortraitUuid;
    if (ref && refs.length < MAX_REFERENCE_IMAGES) {
      refs.push(ref);
      seen.add(speakerName);
    }
  }

  for (const c of entryBeat?.activeCharacters ?? []) {
    if (refs.length >= MAX_REFERENCE_IMAGES) break;
    if (seen.has(c.name)) continue;
    const char = characters.find((x) => x.name === c.name);
    const ref = char?.basePortraitUrl ?? char?.basePortraitUuid;
    if (ref) {
      refs.push(ref);
      seen.add(c.name);
    }
  }

  return refs.slice(0, MAX_REFERENCE_IMAGES);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function tryGenerate(
  config: ProviderConfig,
  prompt: string,
  options: GenerateImageOptions,
  label: string,
): Promise<GenerateImageResult | null> {
  try {
    return await generateImage(config, prompt, options);
  } catch (err) {
    console.warn(`[painter] ${label} failed: ${errMsg(err)}`);
    return null;
  }
}

async function tryGenerateHedged(
  config: ProviderConfig,
  prompt: string,
  options: GenerateImageOptions,
  label: string,
  hedgeMs: number,
): Promise<GenerateImageResult | null> {
  type Settled =
    | { leg: 1 | 2; ok: GenerateImageResult }
    | { leg: 1 | 2; err: unknown };

  const t0 = Date.now();
  const controllers: (AbortController | undefined)[] = [undefined, undefined];
  const fire = (leg: 1 | 2): Promise<Settled> => {
    const ac = new AbortController();
    controllers[leg - 1] = ac;
    return generateImage(config, prompt, {
      ...options,
      retries: 0,
      signal: ac.signal,
    }).then(
      (ok) => ({ leg, ok }) as Settled,
      (err) => ({ leg, err }) as Settled,
    );
  };

  const leg1 = fire(1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hedgeTimer = new Promise<"hedge">((resolve) => {
    timer = setTimeout(() => resolve("hedge"), hedgeMs);
  });

  const first = await Promise.race([leg1, hedgeTimer]);
  if (first !== "hedge") {
    clearTimeout(timer);
    if ("ok" in first) return first.ok;
    console.warn(`[painter] ${label} failed: ${errMsg(first.err)}`);
    return null;
  }

  console.warn(
    `[painter] hedge fired: ${label} still pending after ${hedgeMs}ms`,
  );
  const leg2 = fire(2);

  let result = await Promise.race([leg1, leg2]);
  if ("err" in result) {
    console.warn(
      `[painter] hedge leg${result.leg} failed: ${errMsg(result.err)}`,
    );
    result = await (result.leg === 1 ? leg2 : leg1);
  }

  if ("ok" in result) {
    const loserIdx = result.leg === 1 ? 1 : 0;
    controllers[loserIdx]?.abort();
    const loser = result.leg === 1 ? leg2 : leg1;
    loser.then(
      (s) => "err" in s && console.debug(`[painter] hedge loser leg${s.leg} aborted`),
      () => {},
    );
    console.log(
      `[painter] hedge won by leg${result.leg} in ${Date.now() - t0}ms`,
    );
    return result.ok;
  }
  console.warn(
    `[painter] ${label} failed (both hedge legs): ${errMsg(result.err)}`,
  );
  return null;
}

/**
 * Try a single provider with the full Tier A → Tier B degradation.
 * Returns null if both tiers fail.
 */
async function tryProvider(
  providerLabel: string,
  providerConfig: ProviderConfig,
  prompt: string,
  refs: string[],
  input: PainterInput,
  engineConfig: EngineConfig,
): Promise<PainterResult | null> {
  const t0 = Date.now();
  let error: string | undefined;

  try {
    // Tier A — with referenceImages
    if (refs.length > 0) {
      const tierAOptions: GenerateImageOptions = {
        referenceImages: refs,
        orientation: input.orientation,
        timeoutMs: engineConfig.imageTimeoutMs,
      };
      const label = `[${providerLabel}] referenceImages (${refs.length})`;
      const r =
        engineConfig.imageHedgeMs && engineConfig.imageHedgeMs > 0
          ? await tryGenerateHedged(
              providerConfig,
              prompt,
              tierAOptions,
              label,
              engineConfig.imageHedgeMs,
            )
          : await tryGenerate(providerConfig, prompt, tierAOptions, label);
      if (r) {
        const sla: ImageSlaResult = {
          provider: providerLabel === "primary" ? "primary" : "backup",
          latencyMs: Date.now() - t0,
          success: true,
          model: providerConfig.model,
        };
        recordSla(sla);
        return { kind: "real", imageUrl: r.imageUrl, imageUuid: r.imageUuid };
      }
    }

    // Tier B — pure text-to-image
    const r = await generateImage(providerConfig, prompt, {
      orientation: input.orientation,
      timeoutMs: engineConfig.imageTimeoutMs,
    });
    const sla: ImageSlaResult = {
      provider: providerLabel === "primary" ? "primary" : "backup",
      latencyMs: Date.now() - t0,
      success: true,
      model: providerConfig.model,
    };
    recordSla(sla);
    return { kind: "real", imageUrl: r.imageUrl, imageUuid: r.imageUuid };
  } catch (err) {
    error = errMsg(err);
    console.warn(`[painter] ${providerLabel} provider failed: ${error}`);
    const sla: ImageSlaResult = {
      provider: providerLabel === "primary" ? "primary" : "backup",
      latencyMs: Date.now() - t0,
      success: false,
      model: providerConfig.model,
      error,
    };
    recordSla(sla);
    return null;
  }
}

/**
 * W8: runPainter with provider failover chain.
 *
 * Order: primary → backup → mock (degraded no-image).
 * Each attempt recorded in SLA ledger.
 * Guaranteed to return: never throws, always falls back to mock.
 */
export async function runPainter(
  config: EngineConfig,
  input: PainterInput,
  entryBeat: Beat | undefined,
): Promise<PainterResult> {
  if (config.mockImage) {
    return { kind: "mock", imageUrl: await mockImageDataUri(input.orientation) };
  }

  const prompt = buildPainterPrompt(
    input.integratedPrompt,
    input.styleGuide,
    input.onStageCharacters,
    input.orientation,
  );

  const refs = collectReferenceImages(
    input.onStageCharacters,
    entryBeat,
    input.priorSceneImage,
    input.styleReferenceImage,
  );

  // 1) Primary provider
  const primaryResult = await tryProvider(
    "primary",
    config.image,
    prompt,
    refs,
    input,
    config,
  );
  if (primaryResult) return primaryResult;

  // 2) Backup provider (if configured)
  if (config.imageBackup) {
    const backupResult = await tryProvider(
      "backup",
      config.imageBackup,
      prompt,
      refs,
      input,
      config,
    );
    if (backupResult) return backupResult;
  }

  // 3) Degrade to mock — both providers failed
  const t0 = Date.now();
  const mockUrl = await mockImageDataUri(input.orientation);
  recordSla({
    provider: "mock",
    latencyMs: Date.now() - t0,
    success: true,
    error: "primary+backup failed, degraded to mock",
  });
  console.warn(
    `[painter] both providers failed, degrading to mock (${input.orientation})`,
  );
  return { kind: "mock", imageUrl: mockUrl };
}