/**
 * W5 freeform 配额 + 软墙 + W7 付费墙 + W11 套餐/加量包产品化（进程内账本桩）。
 *
 * 合同：
 * 1. 成功推进才扣点；失败/拦截不扣
 * 2. 软墙：配额不足只挡「下一次推进」，绝不抹掉当前场
 * 3. 充值/升档后额度恢复可推进
 * 4. 每笔 charge / topup / upgrade 写账单流水（requestId 幂等）
 * 5. W11：Plus/Pro 配置生效；图/声加量包可买；套餐目录可查
 *
 * Free 锚：30 对话 / 5 图 / 0 声
 */

export type ResourceKind = "dialogue" | "image" | "tts";

export type PlanTier = "free" | "plus" | "pro";

export type QuotaLimits = {
  dialogue: number;
  image: number;
  tts: number;
};

/** Claude 可验收数字锚；内测后按 P90 回调。可由 env 覆盖。 */
export const PLAN_LIMITS: Record<PlanTier, QuotaLimits> = {
  free: { dialogue: 30, image: 5, tts: 0 },
  plus: { dialogue: 300, image: 80, tts: 40 },
  pro: { dialogue: 1000, image: 250, tts: 150 },
};

export type PlanCatalogEntry = {
  tier: PlanTier;
  label: string;
  priceCny: number;
  period: "month" | "lifetime";
  limits: QuotaLimits;
  features: string[];
};

/** W11：套餐产品目录（价格 + 权益说明 + 生效额度） */
export const PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    tier: "free",
    label: "Free",
    priceCny: 0,
    period: "lifetime",
    limits: PLAN_LIMITS.free,
    features: ["30 对话", "5 出图", "无 TTS", "软墙保留当前场"],
  },
  {
    tier: "plus",
    label: "Plus",
    priceCny: 28,
    period: "month",
    limits: PLAN_LIMITS.plus,
    features: ["300 对话", "80 出图", "40 TTS", "优先队列"],
  },
  {
    tier: "pro",
    label: "Pro",
    priceCny: 98,
    period: "month",
    limits: PLAN_LIMITS.pro,
    features: ["1000 对话", "250 出图", "150 TTS", "SLA 优先"],
  },
];

export type TopupPack = {
  id: string;
  resource: ResourceKind;
  amount: number;
  label: string;
  priceCny: number;
  /** free 也允许买加量包；升级走 upgrade */
  availableOn: PlanTier[];
};

/** W11：加量包（图/声/对话可买，带价） */
export const TOPUP_PACKS: Record<string, TopupPack> = {
  dialogue_50: {
    id: "dialogue_50",
    resource: "dialogue",
    amount: 50,
    label: "对话+50",
    priceCny: 6,
    availableOn: ["free", "plus", "pro"],
  },
  dialogue_200: {
    id: "dialogue_200",
    resource: "dialogue",
    amount: 200,
    label: "对话+200",
    priceCny: 18,
    availableOn: ["free", "plus", "pro"],
  },
  image_20: {
    id: "image_20",
    resource: "image",
    amount: 20,
    label: "图+20",
    priceCny: 8,
    availableOn: ["free", "plus", "pro"],
  },
  image_80: {
    id: "image_80",
    resource: "image",
    amount: 80,
    label: "图+80",
    priceCny: 25,
    availableOn: ["free", "plus", "pro"],
  },
  tts_30: {
    id: "tts_30",
    resource: "tts",
    amount: 30,
    label: "声+30",
    priceCny: 10,
    availableOn: ["free", "plus", "pro"],
  },
  tts_100: {
    id: "tts_100",
    resource: "tts",
    amount: 100,
    label: "声+100",
    priceCny: 28,
    availableOn: ["plus", "pro"],
  },
};

export type SoftWallError = {
  code: "quota_exhausted";
  softWall: true;
  /** 永远 true：当前场必须保留 */
  retained: true;
  resource: ResourceKind;
  remaining: QuotaLimits;
  limit: QuotaLimits;
  /** W7：引导充值 */
  paywall: true;
  message: string;
};

export type ContentBlockError = {
  code: "content_blocked";
  softWall: true;
  retained: true;
  reason: string;
  message: string;
};

export type LedgerEntry = {
  id: string;
  userId: string;
  at: number;
  kind: "charge" | "topup" | "upgrade" | "refund";
  resource?: ResourceKind;
  amount: number;
  requestId: string;
  note?: string;
  balanceAfter?: QuotaLimits;
  tierAfter?: PlanTier;
  priceCny?: number;
};

type Bucket = {
  used: QuotaLimits;
  limit: QuotaLimits;
  tier: PlanTier;
};

const buckets = new Map<string, Bucket>();
const ledgers = new Map<string, LedgerEntry[]>();
/** requestId → ledger id，幂等 */
const idempotency = new Map<string, string>();

function defaultTier(): PlanTier {
  const raw = (process.env.INFI_PLAN_TIER || "free").toLowerCase();
  if (raw === "plus" || raw === "pro") return raw;
  return "free";
}

function ensure(userId: string): Bucket {
  let b = buckets.get(userId);
  if (!b) {
    const tier = defaultTier();
    b = {
      used: { dialogue: 0, image: 0, tts: 0 },
      limit: { ...PLAN_LIMITS[tier] },
      tier,
    };
    buckets.set(userId, b);
  }
  return b;
}

function ledgerOf(userId: string): LedgerEntry[] {
  let L = ledgers.get(userId);
  if (!L) {
    L = [];
    ledgers.set(userId, L);
  }
  return L;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function remainingOf(b: Bucket): QuotaLimits {
  return {
    dialogue: Math.max(0, b.limit.dialogue - b.used.dialogue),
    image: Math.max(0, b.limit.image - b.used.image),
    tts: Math.max(0, b.limit.tts - b.used.tts),
  };
}

export function listPlans(): PlanCatalogEntry[] {
  // 保证 limits 与 PLAN_LIMITS 同源（配置生效）
  return PLAN_CATALOG.map((p) => ({
    ...p,
    limits: { ...PLAN_LIMITS[p.tier] },
  }));
}

export function listPacks(tier?: PlanTier): TopupPack[] {
  return Object.values(TOPUP_PACKS).filter((p) =>
    tier ? p.availableOn.includes(tier) : true,
  );
}

export function getQuotaSnapshot(userId: string): {
  tier: PlanTier;
  used: QuotaLimits;
  limit: QuotaLimits;
  remaining: QuotaLimits;
  paywall: boolean;
  plan: PlanCatalogEntry;
  availablePacks: TopupPack[];
} {
  const b = ensure(userId);
  const remaining = remainingOf(b);
  const plan = listPlans().find((p) => p.tier === b.tier)!;
  return {
    tier: b.tier,
    used: { ...b.used },
    limit: { ...b.limit },
    remaining,
    /** 对话点用尽 = 付费墙亮起（当前场仍可读） */
    paywall: remaining.dialogue <= 0,
    plan,
    availablePacks: listPacks(b.tier),
  };
}

export function getLedger(
  userId: string,
  limit = 50,
): LedgerEntry[] {
  return ledgerOf(userId).slice(-limit).reverse();
}

/**
 * 预检：不够就返回 SoftWallError（不扣点）。
 * 够就返回 null，调用方继续干活，成功后再 charge。
 */
export function checkAdvance(
  userId: string,
  resource: ResourceKind = "dialogue",
): SoftWallError | null {
  const b = ensure(userId);
  const remaining = remainingOf(b);
  if (remaining[resource] <= 0) {
    return {
      code: "quota_exhausted",
      softWall: true,
      retained: true,
      resource,
      remaining,
      limit: { ...b.limit },
      paywall: true,
      message: `配额不足（${resource}）：当前场已保留，充值后可继续推进`,
    };
  }
  return null;
}

/** 成功推进后扣 1 点。失败路径禁止调用。 */
export function chargeSuccess(
  userId: string,
  resource: ResourceKind = "dialogue",
  requestId?: string,
): QuotaLimits {
  const rid = requestId || newId("chg");
  const idemKey = `charge:${userId}:${rid}`;
  if (idempotency.has(idemKey)) {
    return remainingOf(ensure(userId));
  }

  const b = ensure(userId);
  b.used[resource] += 1;
  const rem = remainingOf(b);
  const entry: LedgerEntry = {
    id: newId("led"),
    userId,
    at: Date.now(),
    kind: "charge",
    resource,
    amount: 1,
    requestId: rid,
    note: `consume ${resource}`,
    balanceAfter: rem,
    tierAfter: b.tier,
  };
  ledgerOf(userId).push(entry);
  idempotency.set(idemKey, entry.id);
  console.log(
    `[quota] +1 ${resource} user=${userId} used=${b.used[resource]}/${b.limit[resource]} rem=${rem[resource]}`,
  );
  return rem;
}

/**
 * W7/W11：加量包充值（模拟支付成功回调）。
 * requestId 幂等 — 同一 requestId 不重复加额度。
 * 图/声包可买；tts_100 仅 plus/pro。
 */
export function topup(
  userId: string,
  packId: string,
  requestId: string,
):
  | { ok: true; snapshot: ReturnType<typeof getQuotaSnapshot>; entry: LedgerEntry }
  | { ok: false; error: string } {
  const pack = TOPUP_PACKS[packId];
  if (!pack) return { ok: false, error: `unknown pack: ${packId}` };
  if (!requestId?.trim()) return { ok: false, error: "requestId required" };

  const b = ensure(userId);
  if (!pack.availableOn.includes(b.tier)) {
    return {
      ok: false,
      error: `pack ${packId} not available on tier ${b.tier}`,
    };
  }

  const idemKey = `topup:${userId}:${requestId}`;
  if (idempotency.has(idemKey)) {
    const existingId = idempotency.get(idemKey)!;
    const existing = ledgerOf(userId).find((e) => e.id === existingId);
    return {
      ok: true,
      snapshot: getQuotaSnapshot(userId),
      entry: existing!,
    };
  }

  b.limit[pack.resource] += pack.amount;
  const rem = remainingOf(b);
  const entry: LedgerEntry = {
    id: newId("led"),
    userId,
    at: Date.now(),
    kind: "topup",
    resource: pack.resource,
    amount: pack.amount,
    requestId,
    note: pack.label,
    balanceAfter: rem,
    tierAfter: b.tier,
    priceCny: pack.priceCny,
  };
  ledgerOf(userId).push(entry);
  idempotency.set(idemKey, entry.id);
  console.log(
    `[quota] topup ${pack.label} user=${userId} limit.${pack.resource}=${b.limit[pack.resource]}`,
  );
  return { ok: true, snapshot: getQuotaSnapshot(userId), entry };
}

/**
 * W7/W11：套餐升档。升到更高档时 limit 抬到套餐额度与当前 limit 的较大值
 * （已买加量包不丢）。Plus/Pro 配置从 PLAN_LIMITS 生效。
 */
export function upgradeTier(
  userId: string,
  tier: PlanTier,
  requestId: string,
):
  | { ok: true; snapshot: ReturnType<typeof getQuotaSnapshot>; entry: LedgerEntry }
  | { ok: false; error: string } {
  if (!PLAN_LIMITS[tier]) return { ok: false, error: `unknown tier: ${tier}` };
  if (!requestId?.trim()) return { ok: false, error: "requestId required" };

  const idemKey = `upgrade:${userId}:${requestId}`;
  if (idempotency.has(idemKey)) {
    const existingId = idempotency.get(idemKey)!;
    const existing = ledgerOf(userId).find((e) => e.id === existingId);
    return {
      ok: true,
      snapshot: getQuotaSnapshot(userId),
      entry: existing!,
    };
  }

  const b = ensure(userId);
  const plan = PLAN_LIMITS[tier];
  const catalog = PLAN_CATALOG.find((p) => p.tier === tier);
  b.tier = tier;
  b.limit = {
    dialogue: Math.max(b.limit.dialogue, plan.dialogue),
    image: Math.max(b.limit.image, plan.image),
    tts: Math.max(b.limit.tts, plan.tts),
  };
  const rem = remainingOf(b);
  const entry: LedgerEntry = {
    id: newId("led"),
    userId,
    at: Date.now(),
    kind: "upgrade",
    amount: 0,
    requestId,
    note: `upgrade to ${tier}`,
    balanceAfter: rem,
    tierAfter: tier,
    priceCny: catalog?.priceCny,
  };
  ledgerOf(userId).push(entry);
  idempotency.set(idemKey, entry.id);
  console.log(`[quota] upgrade user=${userId} → ${tier}`);
  return { ok: true, snapshot: getQuotaSnapshot(userId), entry };
}

// ── 违规输入硬拦截（W5 最小集） ──────────────────────────────────────
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /未成年/,
  /未\s*成\s*年/,
  /\b(underage|child\s*porn|cp\s*content|loli\s*sex|shota\s*sex)\b/i,
  /幼女/,
  /萝莉.*[性色]/,
  /儿童.*[性色]/,
];

export function checkFreeformContent(
  text: string,
): ContentBlockError | null {
  const t = text.trim();
  if (!t) {
    return {
      code: "content_blocked",
      softWall: true,
      retained: true,
      reason: "empty",
      message: "输入为空",
    };
  }
  for (const re of HARD_BLOCK_PATTERNS) {
    if (re.test(t)) {
      return {
        code: "content_blocked",
        softWall: true,
        retained: true,
        reason: "hard_redline",
        message: "内容违规：已拦截，当前场保留",
      };
    }
  }
  return null;
}

/** 测试用：重置某用户或全清。 */
export function __resetQuota(userId?: string): void {
  if (userId) {
    buckets.delete(userId);
    ledgers.delete(userId);
    for (const k of [...idempotency.keys()]) {
      if (k.includes(`:${userId}:`)) idempotency.delete(k);
    }
  } else {
    buckets.clear();
    ledgers.clear();
    idempotency.clear();
  }
}

/** 测试用：把某资源用到刚好剩 0（或自定义 used）。 */
export function __setUsed(
  userId: string,
  used: Partial<QuotaLimits>,
  tier: PlanTier = "free",
): void {
  buckets.set(userId, {
    tier,
    limit: { ...PLAN_LIMITS[tier] },
    used: {
      dialogue: used.dialogue ?? 0,
      image: used.image ?? 0,
      tts: used.tts ?? 0,
    },
  });
}
