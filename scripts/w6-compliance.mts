/**
 * W6 合规验收：年龄门 + 分区 + 双向拦截。
 * 运行：node --experimental-strip-types scripts/w6-compliance.mts
 */
import { pathToFileURL } from "node:url";

async function main() {
  const mod = await import(
    pathToFileURL(new URL("../lib/engine/compliance.ts", import.meta.url).pathname).href
  );
  const {
    getAgeGate,
    verifyAge,
    setPreferredZone,
    checkComplianceGate,
    scanContent,
    scanOutput,
    __resetCompliance,
  } = mod as typeof import("../lib/engine/compliance");

  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error("FAIL:", msg);
      failed += 1;
    } else console.log("OK:", msg);
  };

  __resetCompliance();
  const uid = "w6-user";

  // 1) 默认未验证、general
  const g0 = getAgeGate(uid);
  assert(g0.ageVerified === false, "default not age-verified");
  assert(g0.preferredZone === "general", "default zone general");

  // 2) 未验证不能进 adult
  const zden = setPreferredZone(uid, "adult");
  assert("code" in zden && zden.code === "zone_denied", "zone denied without age");
  assert("retained" in zden && zden.retained === true, "zone deny retains");

  // 3) 未成年 birthdate 拒绝
  const under = verifyAge(uid, { birthdate: "2015-01-01" });
  assert("code" in under && under.code === "age_gate", "underage blocked");
  assert(getAgeGate(uid).ageVerified === false, "still unverified after underage");

  // 4) 成年 birthdate 通过
  const ok = verifyAge(uid, { birthdate: "1990-06-15" });
  assert(!("code" in ok) && ok.ageVerified === true, "adult verified");

  // 5) 验证后可切 adult
  const zok = setPreferredZone(uid, "adult");
  assert(!("code" in zok) && zok.preferredZone === "adult", "adult zone ok");

  // 6) hard redline 任何分区都拦
  const hardG = scanContent("描写未成年性行为", "general");
  const hardA = scanContent("描写未成年性行为", "adult");
  assert(!!hardG && hardG.reason === "hard_redline_minor_sexual", "hard general");
  assert(!!hardA && hardA.reason === "hard_redline_minor_sexual", "hard adult");

  // 7) adult_only 在 general 拦、adult 放
  const aoG = scanContent("这是一段色情描写", "general");
  const aoA = scanContent("这是一段色情描写", "adult");
  assert(!!aoG && aoG.reason === "adult_content_in_general_zone", "adult-only in general blocked");
  assert(aoA === null, "adult-only in adult allowed");

  // 8) 闸门：未验证 + adult zone 文本
  __resetCompliance();
  const gate = checkComplianceGate(uid, "你好", { zone: "adult" });
  assert(!!gate && gate.code === "age_gate", "gate age on adult zone");

  // 9) 输出扫描
  __resetCompliance();
  verifyAge(uid, { force: true });
  setPreferredZone(uid, "general");
  const out = scanOutput(uid, "模型输出含色情内容");
  assert(!!out && out.code === "content_blocked", "output scan blocks adult in general");

  // 10) 正常输入放行
  assert(checkComplianceGate(uid, "推开木门走进大厅") === null, "normal input ok");

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nW6 compliance: ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
