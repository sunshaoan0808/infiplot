/**
 * W8 出图 SLA + failover 桩。
 *
 * 合同：
 * 1. 主 → 备 → 降级（mock），层层降，永不挂出图
 * 2. 每枪记录 latency + provider + result，供 SLA 看板
 * 3. 降级后客户端仍可正常推进（无图可玩，不丢场）
 */

export type ImageSlaResult = {
  provider: "primary" | "backup" | "mock";
  latencyMs: number;
  success: boolean;
  /** 实际 model 名（env 值） */
  model?: string;
  error?: string;
};

export type ImageSlaSnapshot = {
  total: number;
  success: number;
  failover: number;
  degraded: number;
  p50Ms: number;
  p95Ms: number;
};

const slaLedger: ImageSlaResult[] = [];

export function recordSla(entry: ImageSlaResult): void {
  slaLedger.push(entry);
  console.log(
    `[image-sla] ${entry.provider} ${entry.success ? "OK" : "FAIL"} ${entry.latencyMs}ms${entry.error ? `: ${entry.error}` : ""}`,
  );
}

export function getSlaSnapshot(): ImageSlaSnapshot {
  const total = slaLedger.length;
  if (total === 0) {
    return { total: 0, success: 0, failover: 0, degraded: 0, p50Ms: 0, p95Ms: 0 };
  }
  const success = slaLedger.filter((e) => e.success).length;
  const failover = slaLedger.filter((e) => e.provider === "backup").length;
  const degraded = slaLedger.filter((e) => e.provider === "mock").length;
  const latencies = slaLedger.map((e) => e.latencyMs).sort((a, b) => a - b);
  const p50Ms = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  return { total, success, failover, degraded, p50Ms, p95Ms };
}

export function __resetSla(): void {
  slaLedger.length = 0;
}