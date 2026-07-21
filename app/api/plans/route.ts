import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { listPlans, listPacks } from "@/lib/engine/quota";

export const runtime = "nodejs";

/** GET /api/plans — 套餐 + 加量包产品目录（W11） */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    plans: listPlans(),
    packs: listPacks(),
  });
}
