/**
 * W5 freeform 配额 + 软墙验收。
 * 运行：node --experimental-strip-types scripts/w5-freeform-quota.mts
 */
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Prefer compiled-less direct import via experimental strip-types
const quotaPath = new URL("../lib/engine/quota.ts", import.meta.url);

async function main() {
  const q = await import(pathToFileURL(quotaPath.pathname).href);
  const {
    checkAdvance,
    chargeSuccess,
    checkFreeformContent,
    getQuotaSnapshot,
    __resetQuota,
    __setUsed,
    PLAN_LIMITS,
  } = q as typeof import("../lib/engine/quota");

  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error("FAIL:", msg);
      failed += 1;
    } else {
      console.log("OK:", msg);
    }
  };

  __resetQuota();
  const uid = "test-user-w5";

  // 1) Free 默认 30 对话
  const snap0 = getQuotaSnapshot(uid);
  assert(snap0.limit.dialogue === PLAN_LIMITS.free.dialogue, "free dialogue=30");
  assert(snap0.remaining.dialogue === 30, "remaining dialogue starts 30");

  // 2) 成功才扣
  assert(checkAdvance(uid, "dialogue") === null, "precheck ok");
  chargeSuccess(uid, "dialogue");
  assert(getQuotaSnapshot(uid).used.dialogue === 1, "used=1 after charge");

  // 3) 软墙：用尽后拒绝，retained=true
  __setUsed(uid, { dialogue: 30 });
  const wall = checkAdvance(uid, "dialogue");
  assert(!!wall && wall.code === "quota_exhausted", "quota_exhausted");
  assert(!!wall && wall.softWall === true, "softWall true");
  assert(!!wall && wall.retained === true, "retained true");
  assert(!!wall && wall.remaining.dialogue === 0, "remaining 0");

  // 4) 违规输入拦截
  const blocked = checkFreeformContent("涉及未成年色情描写");
  assert(!!blocked && blocked.code === "content_blocked", "content blocked");
  assert(!!blocked && blocked.retained === true, "block retains scene");
  assert(checkFreeformContent("我想推开那扇门") === null, "normal freeform ok");

  // 5) 失败路径不扣：用尽后 check 拒绝，used 不变
  const usedBefore = getQuotaSnapshot(uid).used.dialogue;
  checkAdvance(uid, "dialogue");
  assert(getQuotaSnapshot(uid).used.dialogue === usedBefore, "reject does not charge");

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nW5 freeform quota + soft wall: ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
