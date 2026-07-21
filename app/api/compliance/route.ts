import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import {
  getAgeGate,
  verifyAge,
  setPreferredZone,
  type ContentZone,
} from "@/lib/engine/compliance";

export const runtime = "nodejs";

/** GET — 当前用户年龄门 + 分区状态 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(getAgeGate(auth.userId));
}

/**
 * POST — 年龄确认 / 切换分区
 * body: { action: "verify_age", birthdate?: "YYYY-MM-DD" }
 *     | { action: "set_zone", zone: "general" | "adult" }
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: {
    action?: string;
    birthdate?: string;
    zone?: ContentZone;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "verify_age") {
    const result = verifyAge(userId, {
      birthdate: body.birthdate,
      force: !body.birthdate,
    });
    if ("code" in result) {
      return NextResponse.json(result, { status: 403 });
    }
    return NextResponse.json(result);
  }

  if (body.action === "set_zone") {
    if (body.zone !== "general" && body.zone !== "adult") {
      return NextResponse.json({ error: "zone must be general|adult" }, { status: 400 });
    }
    const result = setPreferredZone(userId, body.zone);
    if ("code" in result) {
      return NextResponse.json(result, { status: 403 });
    }
    return NextResponse.json(result);
  }

  return NextResponse.json(
    { error: "action must be verify_age | set_zone" },
    { status: 400 },
  );
}
