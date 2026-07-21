import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import { cloudStoryManifest } from "@/lib/persistence/cloudStore";

export const runtime = "nodejs";

// GET /api/stories/manifest — the reconcile diff basis: every cloud row for the
// signed-in user (INCLUDING tombstones), projected to {id, rev, updatedAt,
// deletedAt} without the bulky session_jsonb. Supports ?workId filter for W10.
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let items = await cloudStoryManifest();
  const url = new URL(req.url);
  const workId = url.searchParams.get("workId");
  if (workId) {
    items = items.filter((i) => i.workId === workId);
  }

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
