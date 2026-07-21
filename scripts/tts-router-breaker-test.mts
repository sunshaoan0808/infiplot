// Offline proof for the TTS ProviderRouter policy (W3).
//
// Drives the REAL synthWithPolicy / breaker / metering-stub code path in
// lib/tts-client/router.ts with fake synth executors — no network, no keys —
// so it asserts the actual degradation + billing contract, not a copy.
//
//   pnpm exec tsx scripts/tts-router-breaker-test.mts
//
// Asserts:
//   1. Success charges the meter exactly once.
//   2. A synth failure does NOT charge the meter (re-throws to caller).
//   3. FAILURE_THRESHOLD consecutive failures OPEN the breaker.
//   4. An open breaker fast-fails (BreakerOpenError) WITHOUT running exec and
//      WITHOUT charging the meter → the caller degrades to silent.
//   5. A success resets the failure count (breaker recovers when closed).

import {
  synthWithPolicy,
  getMeterSnapshot,
  getBreakerState,
  BreakerOpenError,
  __resetMeter,
  __resetBreakers,
} from "../lib/tts-client/router.ts";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

const ok = () => Promise.resolve({ audioBase64: "AAA", mimeType: "audio/wav" });
const boom = () => Promise.reject(new Error("simulated provider 503"));

async function main() {
  __resetMeter();
  __resetBreakers();

  const P = "xiaomi";

  console.log("1) success charges the meter exactly once");
  await synthWithPolicy(P, 10, ok);
  assert(getMeterSnapshot().points === 1, "meter = 1 after one success");

  console.log("2) failure does not charge the meter");
  let threw = false;
  try {
    await synthWithPolicy(P, 10, boom);
  } catch {
    threw = true;
  }
  assert(threw, "synth failure re-throws to caller");
  assert(getMeterSnapshot().points === 1, "meter unchanged after failure");

  console.log("3) a later success resets the failure count");
  await synthWithPolicy(P, 10, ok);
  assert(getBreakerState(P).failures === 0, "failure count reset by success");
  assert(getMeterSnapshot().points === 2, "meter = 2 after second success");

  console.log("4) FAILURE_THRESHOLD (3) consecutive failures open the breaker");
  for (let i = 0; i < 3; i++) {
    try {
      await synthWithPolicy(P, 10, boom);
    } catch {
      /* expected */
    }
  }
  assert(getBreakerState(P).open === true, "breaker OPEN after 3 failures");
  assert(getMeterSnapshot().points === 2, "meter still 2 (no failure billed)");

  console.log("5) open breaker fast-fails WITHOUT running exec or billing");
  let execRan = false;
  let openErr = false;
  try {
    await synthWithPolicy(P, 10, () => {
      execRan = true;
      return ok();
    });
  } catch (e) {
    openErr = e instanceof BreakerOpenError;
  }
  assert(openErr, "throws BreakerOpenError while open");
  assert(execRan === false, "exec was NOT invoked (no network / no timeout)");
  assert(getMeterSnapshot().points === 2, "meter still 2 (short-circuit unbilled)");

  console.log("6) a healthy provider is isolated from a tripped one");
  await synthWithPolicy("stepfun", 5, ok);
  assert(getBreakerState("stepfun").open === false, "stepfun breaker still closed");
  assert(getMeterSnapshot().points === 3, "meter = 3 (stepfun success billed)");

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll ProviderRouter breaker + meter assertions passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
