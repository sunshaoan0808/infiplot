import { classifyFreeform } from "@infiplot/engine";
import type { FreeformClassifyRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig, buildByoEngineConfig } from "@/lib/config";
import { requireUser } from "@/lib/supabase/guard";
import {
  checkAdvance,
  checkFreeformContent,
  chargeSuccess,
  getQuotaSnapshot,
} from "@/lib/engine/quota";

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

  // W5：违规输入硬拦截（当前场保留）
  const blocked = checkFreeformContent(body.freeformText);
  if (blocked) {
    return NextResponse.json(
      { ...blocked, quota: getQuotaSnapshot(userId) },
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
    // 成功才扣
    const remaining = chargeSuccess(userId, "dialogue");
    return NextResponse.json({
      ...result,
      quota: { ...getQuotaSnapshot(userId), remaining },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("Invalid BYO") || message.includes("Missing BYO") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
