import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { getSlaSnapshot } from "@/lib/engine/imageSla";

export const runtime = "nodejs";

/** GET /api/image-sla — 出图 SLA 快照 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(getSlaSnapshot());
}