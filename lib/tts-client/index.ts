import type { CharacterVoice, TtsConfig, TtsProvider } from "@infiplot/types";
import {
  formatStepfunCatalogForPrompt,
  isStepfun,
  isValidStepfunVoiceId,
  stepfunProvision,
  type StepfunProvisionOptions,
} from "./stepfun";
import { xiaomiProvision } from "./xiaomi";
import { routeSynthesize } from "./router";

// Re-export so /api/tts-provider, orchestrator, CharacterDesigner prompt, and
// the client all share ONE provider-detection rule + ONE catalog rendering +
// ONE validity check with the synth path.
export { isStepfun, isValidStepfunVoiceId, formatStepfunCatalogForPrompt };

// Re-export the ProviderRouter surface so tests / observability reach the
// breaker + metering stub without importing a deep path.
export {
  routeSynthesize,
  synthWithPolicy,
  getMeterSnapshot,
  getBreakerState,
  BreakerOpenError,
  __resetMeter,
  __resetBreakers,
} from "./router";
export type { SynthResult } from "./router";

/** Map a configured TtsConfig to its provider tag. Single source of truth for
 *  the inference rule (host contains stepfun.com → stepfun, else xiaomi) so
 *  /api/tts-provider and resolveVoice can't drift when a third provider is
 *  added. A PRESENT TtsConfig always maps to a concrete provider — `null`
 *  (no TTS configured) is the caller's responsibility to handle separately. */
export function inferTtsProvider(cfg: TtsConfig): Exclude<TtsProvider, null> {
  return isStepfun(cfg) ? "stepfun" : "xiaomi";
}

// `opts.stepfunVoiceId` threads the CharacterDesigner's LLM-selected preset
// down to stepfunProvision. Xiaomi ignores it. See StepfunProvisionOptions.
export type ProvisionVoiceOptions = StepfunProvisionOptions;

export async function provisionVoice(
  cfg: TtsConfig,
  description: string,
  // Optional per-character salt (typically the character name). Only
  // StepFun's preset-picker uses it — Xiaomi voicedesign mints a unique
  // clip per call regardless. Threading it through keeps the API uniform
  // and prevents archetype collisions on the StepFun path.
  salt?: string,
  opts?: ProvisionVoiceOptions,
): Promise<CharacterVoice> {
  return isStepfun(cfg)
    ? stepfunProvision(cfg, description, salt, opts)
    : xiaomiProvision(cfg, description);
}

// Dispatch by the voice's own provider tag, not by the current config. A
// session can outlive a provider switch (e.g. .env.local flip mid-game), and
// each voice must be synthesized via the protocol that minted it. The cfg
// still needs to point at the matching provider's endpoint; mismatch surfaces
// as a transparent network error, which `synthesizeBeat` already swallows.
//
// Delegates to the ProviderRouter (routeSynthesize), which layers the
// per-provider circuit breaker + success-only metering stub over the same
// provider dispatch. On a healthy provider the breaker stays closed, so this
// is behavior-equivalent to the historical inline dispatch.
export async function synthesize(
  cfg: TtsConfig,
  voice: CharacterVoice,
  text: string,
  delivery?: string,
  signal?: AbortSignal,
): Promise<{ audioBase64: string; mimeType: string }> {
  return routeSynthesize(cfg, voice, text, delivery, signal);
}
