/**
 * W9 观测台：一页延迟 / 空图 / TTS / 桥接。
 *
 * 合同：
 * 1. 四个信号源统一进 ops snapshot
 * 2. 桌面演练可注入「key 失效」故障，验证降级路径
 * 3. 进程内桩，不依赖外部 Prometheus（后续可换）
 */

// Node ESM (scripts/*.mts) needs explicit .ts; bundler also accepts it.
import { getSlaSnapshot } from "./imageSla.ts";

export type OpsSignal =
  | "latency"
  | "empty_image"
  | "tts"
  | "bridge"
  | "auth_key";

export type OpsEvent = {
  id: string;
  at: number;
  signal: OpsSignal;
  level: "ok" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
};

export type OpsSnapshot = {
  at: number;
  healthy: boolean;
  signals: {
    latency: { p50Ms: number; p95Ms: number; level: "ok" | "warn" | "error" };
    emptyImage: {
      degraded: number;
      failover: number;
      total: number;
      level: "ok" | "warn" | "error";
    };
    tts: { status: "ok" | "degraded" | "down"; note: string };
    bridge: { fusion: "up" | "down" | "unknown"; note: string };
    authKey: { status: "ok" | "invalid" | "drill"; note: string };
  };
  imageSla: ReturnType<typeof getSlaSnapshot>;
  recent: OpsEvent[];
  drills: string[];
};

const events: OpsEvent[] = [];
const drills = new Set<string>();

/** 桌面演练：模拟 key 失效 */
let authKeyDrill = false;

function push(
  signal: OpsSignal,
  level: OpsEvent["level"],
  message: string,
  meta?: Record<string, unknown>,
): OpsEvent {
  const e: OpsEvent = {
    id: `ops_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    signal,
    level,
    message,
    meta,
  };
  events.push(e);
  if (events.length > 200) events.shift();
  return e;
}

export function recordLatency(ms: number, route: string): void {
  const level = ms > 8000 ? "error" : ms > 3000 ? "warn" : "ok";
  push("latency", level, `${route} ${ms}ms`, { ms, route });
}

export function recordEmptyImage(reason: string): void {
  push("empty_image", "warn", reason);
}

export function recordTts(
  status: "ok" | "degraded" | "down",
  note: string,
): void {
  const level = status === "ok" ? "ok" : status === "degraded" ? "warn" : "error";
  push("tts", level, note, { status });
}

export function recordBridge(
  fusion: "up" | "down" | "unknown",
  note: string,
): void {
  const level = fusion === "up" ? "ok" : fusion === "unknown" ? "warn" : "error";
  push("bridge", level, note, { fusion });
}

export function setAuthKeyDrill(on: boolean): OpsEvent {
  authKeyDrill = on;
  drills.add(on ? "auth_key_invalid_on" : "auth_key_invalid_off");
  return push(
    "auth_key",
    on ? "error" : "ok",
    on ? "DRILL: auth key invalid injected" : "DRILL: auth key restored",
  );
}

export function isAuthKeyInvalid(): boolean {
  return authKeyDrill;
}

/** 桌面演练入口：注入/恢复故障 */
export function runDrill(
  name: "auth_key_invalid" | "auth_key_restore" | "empty_image" | "tts_down" | "bridge_down",
): OpsEvent {
  switch (name) {
    case "auth_key_invalid":
      return setAuthKeyDrill(true);
    case "auth_key_restore":
      return setAuthKeyDrill(false);
    case "empty_image":
      drills.add("empty_image");
      return push("empty_image", "warn", "DRILL: empty image simulated");
    case "tts_down":
      drills.add("tts_down");
      return push("tts", "error", "DRILL: TTS provider down");
    case "bridge_down":
      drills.add("bridge_down");
      return push("bridge", "error", "DRILL: Fusion bridge down", {
        fusion: "down",
      });
    default:
      return push("latency", "error", `unknown drill: ${name}`);
  }
}

export function getOpsSnapshot(opts?: {
  fusionProbe?: "up" | "down" | "unknown";
  ttsStatus?: "ok" | "degraded" | "down";
  userId?: string;
}): OpsSnapshot {
  const sla = getSlaSnapshot();
  const latEvents = events.filter((e) => e.signal === "latency");
  const lats = latEvents
    .map((e) => Number(e.meta?.ms ?? 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const p50 = lats[Math.floor(lats.length * 0.5)] ?? sla.p50Ms;
  const p95 = lats[Math.floor(lats.length * 0.95)] ?? sla.p95Ms;

  const latencyLevel: OpsSnapshot["signals"]["latency"]["level"] =
    p95 > 8000 ? "error" : p95 > 3000 || p50 > 2000 ? "warn" : "ok";

  const emptyLevel: OpsSnapshot["signals"]["emptyImage"]["level"] =
    sla.degraded > 0 || sla.total > 0 && sla.success / Math.max(1, sla.total) < 0.8
      ? "warn"
      : "ok";

  const ttsStatus = opts?.ttsStatus ?? (drills.has("tts_down") ? "down" : "ok");
  const fusion =
    opts?.fusionProbe ??
    (drills.has("bridge_down") ? "down" : "unknown");

  const authStatus = authKeyDrill ? "drill" : "ok";

  const healthy =
    latencyLevel !== "error" &&
    emptyLevel !== "error" &&
    ttsStatus !== "down" &&
    fusion !== "down" &&
    !authKeyDrill;

  return {
    at: Date.now(),
    healthy,
    signals: {
      latency: { p50Ms: p50, p95Ms: p95, level: latencyLevel },
      emptyImage: {
        degraded: sla.degraded,
        failover: sla.failover,
        total: sla.total,
        level: emptyLevel,
      },
      tts: {
        status: ttsStatus,
        note: ttsStatus === "ok" ? "TTS path clear" : "TTS degraded/down",
      },
      bridge: {
        fusion,
        note:
          fusion === "up"
            ? "Fusion reachable"
            : fusion === "down"
              ? "Fusion down"
              : "Fusion not probed this tick",
      },
      authKey: {
        status: authStatus,
        note: authKeyDrill
          ? "DRILL active: treat upstream keys as invalid"
          : "keys assumed valid",
      },
    },
    imageSla: sla,
    recent: events.slice(-30).reverse(),
    drills: [...drills],
  };
}

export function __resetOps(): void {
  events.length = 0;
  drills.clear();
  authKeyDrill = false;
}
