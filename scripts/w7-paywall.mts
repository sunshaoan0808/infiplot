/**
 * W7 付费墙 MVP 验收。
 * 运行：node --experimental-strip-types scripts/w7-paywall.mts
 */
import { pathToFileURL } from "node:url";

async function main() {
  const q = await import(
    pathToFileURL(new URL("../lib/engine/quota.ts", import.meta.url).pathname).href
  );
  const {
    checkAdvance,
    chargeSuccess,
    getQuotaSnapshot,
    getLedger,
    topup,
    upgradeTier,
    __resetQuota,
    __setUsed,
    PLAN_LIMITS,
  } = q as typeof import("../lib/engine/quota");

  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error("FAIL:", msg);
      failed += 1;
    } else console.log("OK:", msg);
  };

  __resetQuota();
  const uid = "w7-user";

  // 1) Free 用尽 → 付费墙
  __setUsed(uid, { dialogue: 30 });
  const wall = checkAdvance(uid, "dialogue");
  assert(!!wall && wall.paywall === true, "paywall true when exhausted");
  assert(!!wall && wall.retained === true, "retained on paywall");
  assert(getQuotaSnapshot(uid).paywall === true, "snapshot paywall");

  // 2) 充值后可推进
  const top = topup(uid, "dialogue_50", "req-topup-1");
  assert(top.ok === true, "topup ok");
  if (top.ok) {
    assert(top.snapshot.remaining.dialogue === 50, "remaining 50 after topup");
    assert(top.snapshot.paywall === false, "paywall off after topup");
  }
  assert(checkAdvance(uid, "dialogue") === null, "can advance after topup");

  // 3) 幂等：同 requestId 不双加
  const top2 = topup(uid, "dialogue_50", "req-topup-1");
  assert(top2.ok === true, "idempotent topup ok");
  if (top2.ok) {
    assert(top2.snapshot.limit.dialogue === PLAN_LIMITS.free.dialogue + 50, "no double topup");
  }

  // 4) charge 写账单
  chargeSuccess(uid, "dialogue", "req-charge-1");
  const led = getLedger(uid);
  assert(led.some((e) => e.kind === "topup"), "ledger has topup");
  assert(led.some((e) => e.kind === "charge"), "ledger has charge");
  assert(led[0].requestId.length > 0, "ledger entries have requestId");

  // 5) charge 幂等
  const rem1 = getQuotaSnapshot(uid).remaining.dialogue;
  chargeSuccess(uid, "dialogue", "req-charge-1");
  assert(getQuotaSnapshot(uid).remaining.dialogue === rem1, "charge idempotent");

  // 6) 升档 plus
  const up = upgradeTier(uid, "plus", "req-up-1");
  assert(up.ok === true, "upgrade ok");
  if (up.ok) {
    assert(up.snapshot.tier === "plus", "tier plus");
    // limit 取 max(原+加量, plus)
    assert(
      up.snapshot.limit.dialogue >= PLAN_LIMITS.plus.dialogue,
      "plus dialogue floor",
    );
  }

  // 7) 账单可查
  const all = getLedger(uid, 100);
  assert(all.length >= 3, `ledger length>=3 got ${all.length}`);
  assert(all.every((e) => e.userId === uid), "ledger scoped to user");

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nW7 paywall: ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
