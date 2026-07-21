import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/guard";
import {
  getQuotaSnapshot,
  getLedger,
  topup,
  upgradeTier,
  listPlans,
  listPacks,
  TOPUP_PACKS,
  PLAN_LIMITS,
  type PlanTier,
} from "@/lib/engine/quota";

export const runtime = "nodejs";

/** GET — 配额快照 + 套餐/加量包目录 + 可选账单 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const withLedger = url.searchParams.get("ledger") === "1";
  const snap = getQuotaSnapshot(auth.userId);
  const body = {
    ...snap,
    packs: TOPUP_PACKS,
    plans: PLAN_LIMITS,
    catalog: {
      plans: listPlans(),
      packs: listPacks(),
    },
  };
  if (!withLedger) return NextResponse.json(body);
  return NextResponse.json({
    ...body,
    ledger: getLedger(auth.userId, Number(url.searchParams.get("limit") || 50)),
  });
}

/**
 * POST — 充值 / 升档（模拟支付成功）
 * { action: "topup"|"purchase", packId, requestId }
 * { action: "upgrade", tier, requestId }
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: {
    action?: string;
    packId?: string;
    tier?: PlanTier;
    requestId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.requestId?.trim()) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  if (body.action === "topup" || body.action === "purchase") {
    if (!body.packId) {
      return NextResponse.json({ error: "packId required" }, { status: 400 });
    }
    const result = topup(userId, body.packId, body.requestId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  }

  if (body.action === "upgrade") {
    if (body.tier !== "free" && body.tier !== "plus" && body.tier !== "pro") {
      return NextResponse.json({ error: "tier must be free|plus|pro" }, { status: 400 });
    }
    const result = upgradeTier(userId, body.tier, body.requestId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  }

  return NextResponse.json(
    { error: "action must be topup | purchase | upgrade" },
    { status: 400 },
  );
}
