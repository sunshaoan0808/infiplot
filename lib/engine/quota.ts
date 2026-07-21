/**
 * W5 freeform 配额 + 软墙（进程内账本桩）。
 *
 * 合同（必须活到真账单实现）：
 * 1. 成功推进才扣点；失败/拦截不扣
 * 2. 软墙：配额不足只挡「下一次推进」，绝不抹掉当前场
 * 3. 当前场 + 历史永远可读（本模块只负责推进闸门）
 *
 * Free 锚（Debby R3）：30 对话 / 5 图 / 0 声
 * freeform / insert-beat / scene 推进都算 1 对话点。
 */

export type ResourceKind = "dialogue" | "image" | "tts";

export type PlanTier = "free" | "plus" | "pro";

export type QuotaLimits = {
  dialogue: number;
  image: number;
  tts: number;
};

/** Claude 可验收数字锚；内测后按 P90 回调。 */
export const PLAN_LIMITS: Record<PlanTier, QuotaLimits> = {
  free: { dialogue: 30, image: 5, tts: 0 },
  plus: { dialogue: 300, image: 80, tts: 40 },
  pro: { dialogue: 1000, image: 250, tts: 150 },
};

export type SoftWallError = {
  code: "quota_exhausted";
  softWall: true;
  /** 永远 true：当前场必须保留 */
  retained: true;
  resource: ResourceKind;
  remaining: QuotaLimits;
  limit: QuotaLimits;
  message: string;
};

export type ContentBlockError = {
  code: "content_blocked";
  softWall: true;
  retained: true;
  reason: string;
  message: string;
};

type Bucket = {
  used: QuotaLimits;
  limit: QuotaLimits;
  tier: PlanTier;
};

const buckets = new Map<string, Bucket>();

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

export function remainingOf(b: Bucket): QuotaLimits {
  return {
    dialogue: Math.max(0, b.limit.dialogue - b.used.dialogue),
    image: Math.max(0, b.limit.image - b.used.image),
    tts: Math.max(0, b.limit.tts - b.used.tts),
  };
}

export function getQuotaSnapshot(userId: string): {
  tier: PlanTier;
  used: QuotaLimits;
  limit: QuotaLimits;
  remaining: QuotaLimits;
} {
  const b = ensure(userId);
  return {
    tier: b.tier,
    used: { ...b.used },
    limit: { ...b.limit },
    remaining: remainingOf(b),
  };
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
      message: `配额不足（${resource}）：当前场已保留，充值后可继续推进`,
    };
  }
  return null;
}

/** 成功推进后扣 1 点。失败路径禁止调用。 */
export function chargeSuccess(
  userId: string,
  resource: ResourceKind = "dialogue",
): QuotaLimits {
  const b = ensure(userId);
  b.used[resource] += 1;
  const rem = remainingOf(b);
  console.log(
    `[quota] +1 ${resource} user=${userId} used=${b.used[resource]}/${b.limit[resource]} rem=${rem[resource]}`,
  );
  return rem;
}

// ── 违规输入硬拦截（W5 最小集；W6 再上完整分级） ──────────────────
// 未成年性内容硬红线关键词（中英混）。命中 → 拒绝推进，当前场保留。
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
  if (userId) buckets.delete(userId);
  else buckets.clear();
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
