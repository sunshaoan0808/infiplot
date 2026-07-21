import type { CharacterVoice, TtsConfig } from "@infiplot/types";
import { stepfunSynthesize } from "./stepfun";
import { xiaomiSynthesize } from "./xiaomi";

// ──────────────────────────────────────────────────────────────────────
//  ProviderRouter — ONE synthesize entry in front of the per-provider synth
//  paths (Xiaomi MiMo / StepFun). It adds two cross-cutting concerns without
//  changing the happy path:
//
//    1. Circuit breaker — the primary provider (MiMo) is network-heavy with a
//       30-70s failure tail; after N consecutive failures/timeouts we OPEN the
//       breaker so later synths short-circuit fast (→ synthesizeBeat catches →
//       silent) instead of eating another timeout. A cooldown lets one probe
//       through (HALF-OPEN); success closes it, failure re-opens.
//    2. Metering (stub) — a synth "bills" exactly one point, and ONLY when it
//       actually succeeds. Failures, breaker short-circuits, and silent mode
//       never touch the meter.
//
//  On a healthy provider the breaker stays closed and this is byte-equivalent
//  to calling the provider synth directly. Dispatch is still by the voice's
//  own provider tag (a session can outlive a provider flip), matching the
//  historical `synthesize` in index.ts.
// ──────────────────────────────────────────────────────────────────────

export type SynthResult = { audioBase64: string; mimeType: string };

// ── Metering (stub) ───────────────────────────────────────────────────
// Deliberately a process-local counter + log line, not a real billing sink.
// The CONTRACT is what matters and must survive a real implementation:
// charge exactly once per successful synth, never on failure/degradation.
type MeterEvent = { provider: string; units: number; at: number };
let meterPoints = 0;
const meterLog: MeterEvent[] = [];

function meterChargeSuccess(provider: string, units: number): void {
  meterPoints += 1;
  meterLog.push({ provider, units, at: Date.now() });
  console.log(
    `[tts-meter] +1 point (provider=${provider}, units=${units}, total=${meterPoints})`,
  );
}

/** Read the metering stub's running total + per-synth log. Exported for the
 *  breaker/meter test and any future observability surface. */
export function getMeterSnapshot(): { points: number; events: MeterEvent[] } {
  return { points: meterPoints, events: [...meterLog] };
}

/** Test-only: clear the metering stub so a test can assert exact deltas. */
export function __resetMeter(): void {
  meterPoints = 0;
  meterLog.length = 0;
}

// ── Circuit breaker ───────────────────────────────────────────────────
const FAILURE_THRESHOLD = 3; // consecutive failures before the breaker opens
const COOLDOWN_MS = 30000; // how long the breaker stays open before a probe

type BreakerState = { failures: number; openedAt: number | null };

// Keyed by provider tag so MiMo tripping never silences a healthy StepFun
// (or vice versa) inside the same process.
const breakers = new Map<string, BreakerState>();

function getBreaker(key: string): BreakerState {
  let b = breakers.get(key);
  if (!b) {
    b = { failures: 0, openedAt: null };
    breakers.set(key, b);
  }
  return b;
}

/** Raised when the breaker is OPEN. synthesizeBeat swallows it exactly like a
 *  synth error → the caller plays silent, so a tripped provider degrades
 *  gracefully instead of hard-crashing. */
export class BreakerOpenError extends Error {
  constructor(provider: string) {
    super(`TTS provider "${provider}" circuit breaker open — degraded to silent`);
    this.name = "BreakerOpenError";
  }
}

function canAttempt(b: BreakerState): boolean {
  if (b.openedAt === null) return true; // closed
  if (Date.now() - b.openedAt >= COOLDOWN_MS) return true; // half-open probe
  return false; // open
}

function recordSuccess(b: BreakerState): void {
  b.failures = 0;
  b.openedAt = null;
}

function recordFailure(b: BreakerState): void {
  b.failures += 1;
  // Re-stamp openedAt on every failure past the threshold so a failing
  // half-open probe restarts the cooldown instead of immediately re-probing.
  if (b.failures >= FAILURE_THRESHOLD) b.openedAt = Date.now();
}

/** Test-only: reset all breaker state. */
export function __resetBreakers(): void {
  breakers.clear();
}

/** Inspect a provider's breaker (open/closed + failure count). For the test
 *  and future observability. */
export function getBreakerState(
  provider: string,
): { open: boolean; failures: number } {
  const b = breakers.get(provider);
  if (!b) return { open: false, failures: 0 };
  return { open: b.openedAt !== null && !canAttempt(b), failures: b.failures };
}

// ── Core policy wrapper ───────────────────────────────────────────────
// Breaker + meter around any synth executor. Both the live router entry and
// the offline breaker test drive THIS one code path, so the test proves the
// real degradation logic rather than a copy.
export async function synthWithPolicy(
  providerKey: string,
  meterUnits: number,
  exec: (signal?: AbortSignal) => Promise<SynthResult>,
  signal?: AbortSignal,
): Promise<SynthResult> {
  const breaker = getBreaker(providerKey);
  if (!canAttempt(breaker)) {
    // Fail fast — do NOT run exec (no network, no timeout, no meter).
    throw new BreakerOpenError(providerKey);
  }
  try {
    const result = await exec(signal);
    recordSuccess(breaker);
    meterChargeSuccess(providerKey, meterUnits); // charge ONLY on success
    return result;
  } catch (err) {
    recordFailure(breaker);
    throw err;
  }
}

/** Unified synthesize entry. Dispatches by the voice's own provider tag behind
 *  the breaker + meter. Throws on failure / open breaker (synthesizeBeat
 *  swallows it → silent), so this stays a drop-in for the historical
 *  provider-dispatch `synthesize`. */
export function routeSynthesize(
  cfg: TtsConfig,
  voice: CharacterVoice,
  text: string,
  delivery?: string,
  signal?: AbortSignal,
): Promise<SynthResult> {
  return synthWithPolicy(
    voice.provider,
    text.length,
    (sig) =>
      voice.provider === "stepfun"
        ? stepfunSynthesize(cfg, voice, text, delivery, sig)
        : xiaomiSynthesize(cfg, voice, text, delivery, sig),
    signal,
  );
}
