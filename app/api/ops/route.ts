import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import {
  getOpsSnapshot,
  runDrill,
  recordBridge,
  isAuthKeyInvalid,
} from "@/lib/engine/ops";

export const runtime = "nodejs";

async function probeFusion(): Promise<"up" | "down" | "unknown"> {
  const base =
    process.env.FUSION_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:3017";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `${base}/api/scene-result?sessionId=healthcheck`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    // any HTTP response = process up (404/400 still means alive)
    if (res.status > 0) {
      recordBridge("up", `fusion HTTP ${res.status}`);
      return "up";
    }
    return "unknown";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordBridge("down", msg);
    return "down";
  }
}

/** GET — 一页观测快照（延迟/空图/TTS/桥接/key） */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (isAuthKeyInvalid()) {
    // drill 激活时仍返回快照，但 healthy=false
  }

  const fusion = await probeFusion();
  const snap = getOpsSnapshot({
    fusionProbe: fusion,
    ttsStatus: process.env.TTS_BASE_URL ? "ok" : "degraded",
    userId: auth.userId,
  });
  return NextResponse.json(snap);
}

/**
 * POST — 桌面演练
 * { "drill": "auth_key_invalid" | "auth_key_restore" | "empty_image" | "tts_down" | "bridge_down" }
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let body: { drill?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowed = new Set([
    "auth_key_invalid",
    "auth_key_restore",
    "empty_image",
    "tts_down",
    "bridge_down",
  ]);
  if (!body.drill || !allowed.has(body.drill)) {
    return NextResponse.json(
      { error: "drill must be one of " + [...allowed].join("|") },
      { status: 400 },
    );
  }

  const event = runDrill(body.drill as Parameters<typeof runDrill>[0]);
  const fusion = await probeFusion();
  const snap = getOpsSnapshot({ fusionProbe: fusion });
  return NextResponse.json({ event, snapshot: snap });
}
