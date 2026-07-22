# 商业发布 checklist

> Run `node --experimental-strip-types scripts/w12-release.mts` 一键全验。

| # | 项 | 验收脚本 | 标准 |
|---|-----|----------|------|
| 1 | freeform 输入拦截 | `w5-freeform-quota.mts` | 违规拦、空拦、正常放行 |
| 2 | 配额软墙 + 付费墙 | `w5-freeform-quota.mts` + `w7-paywall.mts` | 用完不扣、充值恢复、账单可查 |
| 3 | 合规年龄门 + 分级 | `w6-compliance.mts` | underage 拦、分区检查、内容拦 |
| 4 | 出图 SLA + failover | `w8-image-sla.mts` | 主路正常、切备正常、双挂无声降级 |
| 5 | TTS 降级（MiMo 断→备） | `tts-router-breaker-test.mts` | MiMo 挂→备正常或 silent |
| 6 | 观测一页 | `w9-ops.mts` | 信号齐全（延迟/空图/桥接） |
| 7 | 多作品切换 | `w10-works.mts` | ≥3 作品、列表隔离、State 不串 |
| 8 | 套餐 + 加量包 | `w11-plans.mts` | Free/Plus/Pro 额度、图/声包可买 |
| 9 | W4 续档 | `e2e` 手动或脚动 | 关浏览器重开保持同 seed |
| 10 | W2 SSE 出图 | `w1-text-first-latency.mts` 手动 | 文先回、图 SSE 到 |
