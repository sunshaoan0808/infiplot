/**
 * W11 套餐与加量包验收。
 * 运行：node --experimental-strip-types scripts/w11-plans.mts
 */
import { pathToFileURL } from "node:url";

async function main() {
  const q = await import(
    pathToFileURL(new URL("../lib/engine/quota.ts", import.meta.url).pathname).href
  );
  const {
    __resetQuota,
    __setUsed,
    checkAdvance,
    chargeSuccess,
    upgradeTier,
    topup,
    getQuotaSnapshot,
    listPlans,
    listPacks,
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
  const uid = "w11-user";

  // 1) catalog: Plus/Pro 配置存在且与 PLAN_LIMITS 同源
  const plans = listPlans();
  assert(plans.length === 3, "3 plans");
  const plus = plans.find((p) => p.tier === "plus")!;
  const pro = plans.find((p) => p.tier === "pro")!;
  assert(plus.priceCny === 28, "plus price");
  assert(pro.priceCny === 98, "pro price");
  assert(plus.limits.dialogue === PLAN_LIMITS.plus.dialogue, "plus dialogue limit live");
  assert(pro.limits.image === PLAN_LIMITS.pro.image, "pro image limit live");
  assert(plus.limits.tts === 40, "plus tts 40");
  assert(pro.limits.tts === 150, "pro tts 150");

  // 2) free 用尽 → 墙；升 Plus 后配置生效可推进
  __setUsed(uid, { dialogue: 30, image: 0, tts: 0 }, "free");
  assert(checkAdvance(uid, "dialogue") !== null, "free exhausted wall");
  const up = upgradeTier(uid, "plus", "up-plus-1");
  assert(up.ok === true, "upgrade plus ok");
  const snapPlus = getQuotaSnapshot(uid);
  assert(snapPlus.tier === "plus", "tier plus");
  assert(snapPlus.limit.dialogue >= PLAN_LIMITS.plus.dialogue, "plus limit applied");
  assert(snapPlus.limit.image >= PLAN_LIMITS.plus.image, "plus image applied");
  assert(snapPlus.limit.tts >= PLAN_LIMITS.plus.tts, "plus tts applied");
  assert(checkAdvance(uid, "dialogue") === null, "after plus can advance");
  chargeSuccess(uid, "dialogue", "chg-1");

  // 3) 升 Pro：配置生效
  const up2 = upgradeTier(uid, "pro", "up-pro-1");
  assert(up2.ok === true, "upgrade pro ok");
  const snapPro = getQuotaSnapshot(uid);
  assert(snapPro.tier === "pro", "tier pro");
  assert(snapPro.limit.dialogue >= PLAN_LIMITS.pro.dialogue, "pro dialogue");
  assert(snapPro.limit.image >= PLAN_LIMITS.pro.image, "pro image");
  assert(snapPro.limit.tts >= PLAN_LIMITS.pro.tts, "pro tts");

  // 4) 图加量包可买
  const beforeImg = getQuotaSnapshot(uid).limit.image;
  const buyImg = topup(uid, "image_20", "buy-img-1");
  assert(buyImg.ok === true, "buy image_20");
  assert(
    getQuotaSnapshot(uid).limit.image === beforeImg + 20,
    "image +20 applied",
  );
  assert(buyImg.ok && buyImg.entry.priceCny === 8, "image pack priced");

  // 5) 声加量包可买
  const beforeTts = getQuotaSnapshot(uid).limit.tts;
  const buyTts = topup(uid, "tts_30", "buy-tts-1");
  assert(buyTts.ok === true, "buy tts_30");
  assert(
    getQuotaSnapshot(uid).limit.tts === beforeTts + 30,
    "tts +30 applied",
  );

  // 6) free 不能买 tts_100；plus 可以
  __resetQuota("free-user");
  __setUsed("free-user", {}, "free");
  const deny = topup("free-user", "tts_100", "deny-1");
  assert(deny.ok === false, "free cannot buy tts_100");
  __setUsed("plus-user", {}, "plus");
  const allow = topup("plus-user", "tts_100", "allow-1");
  assert(allow.ok === true, "plus can buy tts_100");

  // 7) packs 列表含图/声
  const packs = listPacks();
  assert(packs.some((p) => p.resource === "image"), "has image packs");
  assert(packs.some((p) => p.resource === "tts"), "has tts packs");
  assert(listPacks("free").every((p) => p.availableOn.includes("free")), "free filter");

  // 8) 幂等
  const again = topup(uid, "image_20", "buy-img-1");
  assert(again.ok === true, "idempotent topup");
  assert(
    getQuotaSnapshot(uid).limit.image === beforeImg + 20,
    "idempotent no double credit",
  );

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nW11 plans+packs: ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
