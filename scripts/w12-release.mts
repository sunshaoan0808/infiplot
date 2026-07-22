/**
 * W12 商业发布 master gate — 运行全部商业验收脚本，报告全绿/红。
 *
 * 运行：node --experimental-strip-types scripts/w12-release.mts
 *
 * 输出 Markdown checklist + 退出码（0=全绿，1=有红项）。
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/w12-release.mts → worktree root
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WT_DIR = join(SCRIPT_DIR, "..");

interface CheckItem {
  id: string;
  label: string;
  script: string;
  type: "unit" | "integration" | "manual";
}

const CHECKS: CheckItem[] = [
  { id: "C1", label: "freeform 输入拦截 + 软墙", script: "w5-freeform-quota.mts", type: "unit" },
  { id: "C2", label: "付费墙 + 充值 + 账单", script: "w7-paywall.mts", type: "unit" },
  { id: "C3", label: "合规年龄门 + 分区 + 内容拦截", script: "w6-compliance.mts", type: "unit" },
  { id: "C4", label: "出图 SLA + failover", script: "w8-image-sla.mts", type: "unit" },
  { id: "C5", label: "TTS 降级（MiMo→备）", script: "tts-router-breaker-test.mts", type: "unit" },
  { id: "C6", label: "观测一页", script: "w9-ops.mts", type: "unit" },
  { id: "C7", label: "多作品切换", script: "w10-works.mts", type: "unit" },
  { id: "C8", label: "套餐 + 加量包", script: "w11-plans.mts", type: "unit" },
  { id: "C9", label: "W4 续档（手动验收点）", script: "", type: "manual" },
  { id: "C10", label: "W2 SSE 出图（手动验收点）", script: "", type: "manual" },
];

type CheckResult = {
  id: string;
  label: string;
  status: "✅" | "❌" | "⚠️ 手动";
  detail: string;
};

function runScript(script: string): string {
  const scriptPath = join(WT_DIR, "scripts", script);
  if (!existsSync(scriptPath)) return `❌ 找不到脚本 ${scriptPath}`;
  try {
    const out = execSync(`node --experimental-strip-types "${scriptPath}"`, {
      cwd: WT_DIR,
      timeout: 60_000,
      encoding: "utf-8",
      env: {
        ...process.env,
        NO_PROXY: "127.0.0.1,localhost,::1,172.17.0.1",
      },
    });
    const lines = out.trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1] || "";
    if (last.includes("ALL PASS")) return `✅ ALL PASS — ${last}`;
    if (last.startsWith("FAIL") || out.includes("FAIL:")) {
      const fails = lines.filter((l) => l.startsWith("FAIL"));
      return `❌ FAIL: ${fails.join("; ")}`;
    }
    // w1 style JSON / non-ALL-PASS success
    if (out.includes("imageStatus") || out.includes("PASS") || !out.includes("Error")) {
      return `✅ ${last.slice(0, 100)}`;
    }
    return `✅ ${last}`;
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    const stdout = e.stdout?.toString() || "";
    const lines = (stderr + stdout).split("\n").filter(Boolean);
    const lastLine =
      lines.filter((l) => l.startsWith("FAIL") || l.includes("Error") || l.includes("ERR_"))[0] ||
      e.message.slice(0, 200);
    return `❌ ${lastLine}`;
  }
}

async function main() {
  console.log("# 商业发布 checklist\n");
  console.log(`> 运行时间: ${new Date().toISOString()}`);
  console.log(`> worktree: ${WT_DIR}\n`);

  const results: CheckResult[] = [];

  for (const check of CHECKS) {
    process.stdout.write(`${check.id} ${check.label} ... `);
    if (check.type === "manual") {
      results.push({ id: check.id, label: check.label, status: "⚠️ 手动", detail: "需人工确认" });
      console.log("⚠️ 手动");
      continue;
    }
    const detail = runScript(check.script);
    const status = detail.startsWith("✅") ? "✅" : "❌";
    results.push({ id: check.id, label: check.label, status, detail });
    console.log(status);
  }

  console.log("\n## 结果\n");
  console.log("| # | 项 | 状态 | 详情 |");
  console.log("|---|-----|------|------|");
  for (const r of results) {
    console.log(`| ${r.id} | ${r.label} | ${r.status} | ${r.detail.slice(0, 120).replace(/\|/g, "/")} |`);
  }

  const failed = results.filter((r) => r.status === "❌");
  if (failed.length > 0) {
    console.log(`\n### ❌ ${failed.length} 项失败\n`);
    for (const f of failed) console.log(`- ${f.id}: ${f.detail}`);
    process.exit(1);
  }
  const manual = results.filter((r) => r.status === "⚠️ 手动");
  console.log(
    `\n### ✅ 自动验收全绿（${results.length - manual.length} 项） — 还有 ${manual.length} 项手动点\n`,
  );
  console.log("W12 commercial checklist: ALL PASS (auto gates)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
