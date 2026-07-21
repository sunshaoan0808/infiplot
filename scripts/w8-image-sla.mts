/**
 * W8 出图 SLA + failover 验收。
 * 运行：node --experimental-strip-types scripts/w8-image-sla.mts
 */
import { pathToFileURL } from "node:url";

async function main() {
  const sla = await import(
    pathToFileURL(new URL("../lib/engine/imageSla.ts", import.meta.url).pathname).href
  );
  const { recordSla, getSlaSnapshot, __resetSla } = sla as typeof import("../lib/engine/imageSla");

  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error("FAIL:", msg);
      failed += 1;
    } else console.log("OK:", msg);
  };

  __resetSla();

  // 1) Empty snapshot
  const empty = getSlaSnapshot();
  assert(empty.total === 0, "empty snapshot");

  // 2) Primary success
  recordSla({ provider: "primary", latencyMs: 5000, success: true, model: "flux-2" });
  recordSla({ provider: "primary", latencyMs: 3000, success: true, model: "flux-2" });
  let snap = getSlaSnapshot();
  assert(snap.total === 2, "total 2");
  assert(snap.success === 2, "success 2");
  assert(snap.failover === 0, "no failover yet");
  assert(snap.degraded === 0, "no degraded yet");
  assert(snap.p50Ms === 5000, `p50~5000 got ${snap.p50Ms}`); // [3000,5000] → median index 1 → 5000

  // 3) Backup failover
  recordSla({ provider: "backup", latencyMs: 8000, success: true, model: "dall-e-3" });
  snap = getSlaSnapshot();
  assert(snap.total === 3, "total 3");
  assert(snap.failover === 1, "failover 1");

  // 4) Degraded to mock
  recordSla({ provider: "mock", latencyMs: 100, success: true, error: "both failed" });
  snap = getSlaSnapshot();
  assert(snap.total === 4, "total 4");
  assert(snap.degraded === 1, "degraded 1");

  // 5) Primary failure
  recordSla({ provider: "primary", latencyMs: 15000, success: false, error: "timeout" });
  snap = getSlaSnapshot();
  assert(snap.total === 5, "total 5");
  assert(snap.success === 4, "success 4");

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nW8 image SLA: ALL PASS");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});