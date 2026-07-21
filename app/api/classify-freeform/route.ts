import { classifyFreeform } from "@infiplot/engine";
import type { FreeformClassifyRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig, buildByoEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";
import {
  checkAdvance,
  chargeSuccess,
  getQuotaSnapshot,
} from "@/lib/engine/quota";
import {
  checkComplianceGate,
  scanOutput,
  getAgeGate,
} from "@/lib/engine/compliance";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: FreeformClassifyRequest;
  try {
    body = (await req.json()) as FreeformClassifyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session || !body.freeformText?.trim()) {
    return NextResponse.json(
      { error: "session and freeformText are required" },
      { status: 400 },
    );
  }

  // W6：年龄门 + 输入双向扫描
  const compliance = checkComplianceGate(userId, body.freeformText);
  if (compliance) {
    return NextResponse.json(
      { ...compliance, ageGate: getAgeGate(userId), quota: getQuotaSnapshot(userId) },
      { status: 403 },
    );
  }

  // W5：软墙 — 配额不足只挡本次推进
  const wall = checkAdvance(userId, "dialogue");
  if (wall) {
    return NextResponse.json(
      { ...wall, quota: getQuotaSnapshot(userId) },
      { status: 402 },
    );
  }

  try {
    const official = loadEngineConfig();
    const config = body.byo ? buildByoEngineConfig(body.byo, official) : official;
    const result = await classifyFreeform(config, body);

    // W6 输出扫描（freeformAction 回写）
    const outBlock = scanOutput(userId, result.freeformAction ?? "");
    if (outBlock) {
      return NextResponse.json(
        { ...outBlock, ageGate: getAgeGate(userId), quota: getQuotaSnapshot(userId) },
        { status: 403 },
      );
    }

    const remaining = chargeSuccess(userId, "dialogue");
    return NextResponse.json({
      ...result,
      quota: { ...getQuotaSnapshot(userId), remaining },
      ageGate: getAgeGate(userId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Invalid BYO") || message.includes("Missing BYO") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
