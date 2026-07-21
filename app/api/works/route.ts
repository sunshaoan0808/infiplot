import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { listWorks, getWork } from "@/lib/engine/works";

export const runtime = "nodejs";

/** GET /api/works — list all available works */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const workId = url.searchParams.get("id");

  if (workId) {
    const work = getWork(workId);
    if (!work) {
      return NextResponse.json({ error: `unknown work: ${workId}` }, { status: 404 });
    }
    return NextResponse.json(work);
  }

  const works = listWorks();
  return NextResponse.json({ works });
}