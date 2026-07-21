import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { getQuotaSnapshot } from "@/lib/engine/quota";

export const runtime = "nodejs";

/** W5：查询当前用户配额快照（软墙前端可展示 remaining）。 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(getQuotaSnapshot(auth.userId));
}
