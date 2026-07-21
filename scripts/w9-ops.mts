/**
 * W9 观测 + 事故演练验收。
 * 运行：node --experimental-strip-types scripts/w9-ops.mts
 */
import { pathToFileURL } from "node:url";

async function main() {
  // Ensure relative .ts imports resolve under --experimental-strip-types
  const mod = await import(
    pathToFileURL(new URL("../lib/engine/ops.ts", import.meta.url).pathname).href
  );
  const {
    recordLatency,
    recordEmptyImage,
    recordTts,
    recordBridge,
    runDrill,
    getOpsSnapshot,
    isAuthKeyInvalid,
    __resetOps,
  } = mod as typeof import("../lib/engine/ops");

  // imageSla is dependency — reset via dynamic if needed
  try {
    const sla = await import(
      pathToFileURL(new URL("../lib/engine/imageSla.ts", import.meta.url).pathname)
        .href
    );
    (sla as { __resetSla?: () => void }).__resetSla?.();
  } catch {
    /* optional */
  }

  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error("FAIL:", msg);
      failed += 1;
    } else console.log("OK:", msg);
  };

  __resetOps();

  // 1) 健康基线
  let snap = getOpsSnapshot({ fusionProbe: "up", ttsStatus: "ok" });
  assert(snap.healthy === true, "baseline healthy");
  assert(snap.signals.latency.level === "ok", "latency ok empty");
  assert(snap.signals.authKey.status === "ok", "auth ok");

  // 2) 延迟记录
  recordLatency(500, "/api/scene");
  recordLatency(9000, "/api/start");
  snap = getOpsSnapshot({ fusionProbe: "up", ttsStatus: "ok" });
  assert(snap.signals.latency.p95Ms >= 9000, "p95 high");
  assert(snap.signals.latency.level === "error", "latency red");
  assert(snap.healthy === false, "unhealthy when latency red");

  // 3) 空图
  recordEmptyImage("painter mock degrade");
  snap = getOpsSnapshot({ fusionProbe: "up", ttsStatus: "ok" });
  assert(snap.recent.some((e) => e.signal === "empty_image"), "empty image event");

  // 4) TTS / bridge
  recordTts("degraded", "silent fallback");
  recordBridge("up", "probe ok");
  snap = getOpsSnapshot({ fusionProbe: "up", ttsStatus: "degraded" });
  assert(snap.signals.tts.status === "degraded", "tts degraded");
  assert(snap.signals.bridge.fusion === "up", "bridge up");

  // 5) 桌面演练 key 失效
  const drill = runDrill("auth_key_invalid");
  assert(drill.signal === "auth_key", "drill event");
  assert(isAuthKeyInvalid() === true, "key invalid flag");
  snap = getOpsSnapshot({ fusionProbe: "up", ttsStatus: "ok" });
  assert(snap.signals.authKey.status === "drill", "auth drill status");
  assert(snap.healthy === false, "unhealthy under key drill");
  assert(snap.drills.includes("auth_key_invalid_on"), "drill listed");

  // 6) 恢复
  runDrill("auth_key_restore");
  assert(isAuthKeyInvalid() === false, "key restored");
  __resetOps();
  recordLatency(200, "/api/scene");
  snap = getOpsSnapshot({ fusionProbe: "up", ttsStatus: "ok" });
  assert(snap.healthy === true, "healthy after restore+reset");

  // 7) 一页四信号都在
  assert(
    ["latency", "emptyImage", "tts", "bridge", "authKey"].every(
      (k) => k in snap.signals,
    ),
    "one-page signals present",
  );

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nW9 ops: ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
