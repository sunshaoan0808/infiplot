import { requestInsertBeat } from "@infiplot/engine";
import type { InsertBeatRequest } from "@infiplot/types";
import { NextResponse } from "next/server";
import { loadEngineConfig } from "@/lib/config";
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

  let body: InsertBeatRequest;
  try {
    body = (await req.json()) as InsertBeatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.session || !body.freeformAction) {
    return NextResponse.json(
      { error: "session and freeformAction are required" },
      { status: 400 },
    );
  }

  const compliance = checkComplianceGate(userId, body.freeformAction);
  if (compliance) {
    return NextResponse.json(
      { ...compliance, ageGate: getAgeGate(userId), quota: getQuotaSnapshot(userId) },
      { status: 403 },
    );
  }

  const wall = checkAdvance(userId, "dialogue");
  if (wall) {
    return NextResponse.json(
      { ...wall, quota: getQuotaSnapshot(userId) },
      { status: 402 },
    );
  }

  try {
    const base = loadEngineConfig();
    const config = body.clientTts === true ? { ...base, tts: undefined } : base;
    const result = await requestInsertBeat(config, body);

    const outText = [
      result.partial?.narration,
      result.partial?.line,
      ...(result.extraBeats ?? []).flatMap((b) => [b.narration, b.line]),
    ]
      .filter(Boolean)
      .join("\n");
    const outBlock = scanOutput(userId, outText);
    if (outBlock) {
      return NextResponse.json(
        { ...outBlock, ageGate: getAgeGate(userId), quota: getQuotaSnapshot(userId) },
        { status: 403 },
      );
    }

    const remaining = chargeSuccess(userId, "dialogue");
    return NextResponse.json({
      ...result,
      characters: result.characters.map((c) => ({ ...c, voice: undefined })),
      quota: { ...getQuotaSnapshot(userId), remaining },
      ageGate: getAgeGate(userId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
