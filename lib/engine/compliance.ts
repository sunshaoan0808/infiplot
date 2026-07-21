/**
 * W6 合规分级：年龄门 + 内容分区 + 双向内容检测。
 *
 * 合同（Debby R3）：
 * - 成人向保留，未成年性内容硬红线 100% 拦截
 * - 年龄门：未确认 18+ 不可进 adult 分区
 * - 分区：general / adult；adult 需要 ageVerified
 * - 双向：输入（freeform/worldSetting）+ 输出（scene 文本）都过同一检测器
 * - 软墙原则：拦截不抹当前场（retained=true）
 */

export type ContentZone = "general" | "adult";

export type AgeGateState = {
  userId: string;
  ageVerified: boolean;
  /** ISO birthdate optional; if set, age computed at check time */
  birthdate?: string;
  verifiedAt?: number;
  preferredZone: ContentZone;
};

export type ComplianceBlock = {
  code: "age_gate" | "zone_denied" | "content_blocked";
  softWall: true;
  retained: true;
  reason: string;
  zone?: ContentZone;
  message: string;
};

const ageGates = new Map<string, AgeGateState>();

export function getAgeGate(userId: string): AgeGateState {
  let g = ageGates.get(userId);
  if (!g) {
    g = {
      userId,
      ageVerified: false,
      preferredZone: "general",
    };
    ageGates.set(userId, g);
  }
  return { ...g };
}

/** 用户确认 18+（或提供 birthdate 且 ≥18）。 */
export function verifyAge(
  userId: string,
  opts?: { birthdate?: string; force?: boolean },
): AgeGateState | ComplianceBlock {
  const g = ageGates.get(userId) ?? {
    userId,
    ageVerified: false,
    preferredZone: "general" as ContentZone,
  };

  if (opts?.birthdate) {
    const age = ageFromBirthdate(opts.birthdate);
    if (age === null) {
      return {
        code: "age_gate",
        softWall: true,
        retained: true,
        reason: "invalid_birthdate",
        message: "出生日期无效",
      };
    }
    if (age < 18) {
      g.ageVerified = false;
      g.birthdate = opts.birthdate;
      ageGates.set(userId, g);
      return {
        code: "age_gate",
        softWall: true,
        retained: true,
        reason: "underage",
        message: "未满 18 岁，不可进入成人分区",
      };
    }
    g.ageVerified = true;
    g.birthdate = opts.birthdate;
    g.verifiedAt = Date.now();
    ageGates.set(userId, g);
    return { ...g };
  }

  // 显式确认（checkbox / 按钮）
  if (opts?.force !== false) {
    g.ageVerified = true;
    g.verifiedAt = Date.now();
    ageGates.set(userId, g);
  }
  return { ...g };
}

export function setPreferredZone(
  userId: string,
  zone: ContentZone,
): AgeGateState | ComplianceBlock {
  const g = getAgeGate(userId);
  if (zone === "adult" && !g.ageVerified) {
    return {
      code: "zone_denied",
      softWall: true,
      retained: true,
      reason: "age_not_verified",
      zone,
      message: "进入成人分区前请先完成年龄确认",
    };
  }
  const next: AgeGateState = { ...g, preferredZone: zone };
  ageGates.set(userId, next);
  return next;
}

function ageFromBirthdate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const birth = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  const bd = mo * 100 + d;
  if (md < bd) age -= 1;
  return age;
}

// ── 双向内容检测 ──────────────────────────────────────────────────────
// hard：未成年性内容 — 任何分区一律拦
// adult_only：成人向性内容 — general 分区拦，adult 放行

const HARD_REDLINE: RegExp[] = [
  /未成年/,
  /未\s*成\s*年/,
  /\b(underage|child\s*porn|cp\s*content|loli\s*sex|shota\s*sex)\b/i,
  /幼女/,
  /萝莉.*[性色]/,
  /儿童.*[性色]/,
  /小学生.*[性色]/,
];

const ADULT_ONLY: RegExp[] = [
  /\b(nsfw|explicit\s*sex|porn)\b/i,
  /色情/,
  /性交/,
  /裸体描写/,
  /成人向性爱/,
];

export type ScanDirection = "input" | "output";

export function scanContent(
  text: string,
  zone: ContentZone,
  _direction: ScanDirection = "input",
): ComplianceBlock | null {
  const t = (text || "").trim();
  if (!t) return null;

  for (const re of HARD_REDLINE) {
    if (re.test(t)) {
      return {
        code: "content_blocked",
        softWall: true,
        retained: true,
        reason: "hard_redline_minor_sexual",
        zone,
        message: "内容违规（未成年性内容硬红线）：已拦截，当前场保留",
      };
    }
  }

  if (zone === "general") {
    for (const re of ADULT_ONLY) {
      if (re.test(t)) {
        return {
          code: "content_blocked",
          softWall: true,
          retained: true,
          reason: "adult_content_in_general_zone",
          zone,
          message: "成人内容不可在大众分区出现，请切换成人分区或修改输入",
        };
      }
    }
  }

  return null;
}

/**
 * 推进前合规闸：年龄门（adult 分区）+ 输入扫描。
 * 返回 null = 放行。
 */
export function checkComplianceGate(
  userId: string,
  text: string,
  opts?: { zone?: ContentZone; direction?: ScanDirection },
): ComplianceBlock | null {
  const gate = getAgeGate(userId);
  const zone = opts?.zone ?? gate.preferredZone;

  if (zone === "adult" && !gate.ageVerified) {
    return {
      code: "age_gate",
      softWall: true,
      retained: true,
      reason: "age_not_verified",
      zone,
      message: "成人分区需要先完成 18+ 年龄确认",
    };
  }

  return scanContent(text, zone, opts?.direction ?? "input");
}

/** 扫描模型输出（scene 文案 / freeform 结果）。 */
export function scanOutput(
  userId: string,
  text: string,
  zone?: ContentZone,
): ComplianceBlock | null {
  const gate = getAgeGate(userId);
  return scanContent(text, zone ?? gate.preferredZone, "output");
}

export function __resetCompliance(userId?: string): void {
  if (userId) ageGates.delete(userId);
  else ageGates.clear();
}
