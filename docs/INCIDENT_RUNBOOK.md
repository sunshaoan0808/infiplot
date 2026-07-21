# Infi 事故手册（W9）

一页运维：延迟 / 空图 / TTS / 桥接 / key 失效。  
桌面演练：`POST /api/ops` 注入故障，看 `GET /api/ops` 红灯。

## 0. 30 秒看健康

```bash
# 本机 Infi（端口按部署）
curl -sS http://127.0.0.1:3003/api/ops | jq '{healthy,signals}'
curl -sS http://127.0.0.1:3003/api/image-sla | jq .
curl -sS http://127.0.0.1:3017/api/scene-result?sessionId=healthcheck -o /dev/null -w 'fusion:%{http_code}\n'
```

| 信号 | 绿 | 黄 | 红 |
|------|----|----|----|
| latency | p95≤3s | 3–8s | >8s |
| empty_image | degraded=0 | degraded>0 或成功率<80% | 连续双挂+无 mock |
| tts | ok | degraded/silent | down 且业务要求有声 |
| bridge | fusion up | unknown | fusion down |
| auth_key | ok | — | drill/invalid |

## 1. 延迟飙高

**现象：** `/api/start` `/api/scene` 文本路径慢；或 Painter 拖死（应已文先回）。

**查：**
1. `GET /api/ops` → `signals.latency`
2. 日志搜 `[quota]` `[painter]` `[image-sla]`
3. 上游 LLM/图：CPA/Axon/Runware 是否 429/超时

**处：**
- 文本：切备 LLM 或降 max_tokens；确认文先回未 await 图
- 图：看 W8 failover 是否进 backup/mock；`IMAGE_BACKUP_*` 是否配
- 临时：`MOCK_IMAGE=true` 保可玩

## 2. 空图 / 出图失败

**现象：** `imageStatus=failed` / SSE `image.failed` / 一直 pending。

**查：**
1. `GET /api/image-sla` → failover / degraded / p95
2. `IMAGE_BASE_URL` key 是否 401
3. SSE 是否在 `done` 后仍等 `imageWait`（W2）

**处：**
- 主挂 → 自动备（W8）；双挂 → mock，**无图可玩**
- 修 key 后不必重启会话；下一场重画
- 演练：`POST /api/ops {"drill":"empty_image"}`

## 3. TTS 挂

**现象：** 无声 / 供应商标错。

**查：**
1. `GET /api/tts-provider`
2. W3 router 是否 silent 降级
3. `TTS_*` env / 客户端 BYO key

**处：**
- 允许 silent：业务继续，不扣 TTS 点
- 有备源：Router 切备；成功才计量（W3/W5 合同）
- 演练：`{"drill":"tts_down"}`

## 4. Fusion 桥接挂

**现象：** 推进失败、scene-result 非 2xx、续档对不上。

**查：**
```bash
curl -sS -m 5 -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3017/api/scene-result?sessionId=healthcheck'
```
1. Fusion 进程 / 3017 监听
2. Infi 侧 base URL 是否指错
3. 单一真相：是否误用 Infi 本地推进入档

**处：**
- 起 Fusion；Infi 只读演出，不写权威进度
- 演练：`{"drill":"bridge_down"}`

## 5. Key 失效（桌面演练必做）

**现象：** 401 / provider unauthorized。

**演练步骤：**
```bash
# 注入
curl -sS -X POST http://127.0.0.1:3003/api/ops \
  -H 'content-type: application/json' \
  -d '{"drill":"auth_key_invalid"}' | jq .

# 看红灯
curl -sS http://127.0.0.1:3003/api/ops | jq '.signals.authKey, .healthy'

# 恢复
curl -sS -X POST http://127.0.0.1:3003/api/ops \
  -H 'content-type: application/json' \
  -d '{"drill":"auth_key_restore"}' | jq .
```

**真故障处：**
1. 换 env key，**不要**把 key 打进日志/PR
2. 图：W8 走 backup；文本：切备渠道
3. 配额/账单不受 key 演练影响（当前场 retained）

## 6. 付费墙 / 配额（连带）

- 用尽：`402` + `softWall` + `retained` + `paywall`
- 充值：`POST /api/quota` `{action:topup|upgrade, requestId}`
- 流水：`GET /api/quota?ledger=1`

## 7. 合规拦截（连带）

- `403` + `content_blocked` / `age_gate` / `zone_denied`
- **不抹当前场**；先 `/api/compliance` 看年龄门与分区

## 8. 联系与升级

| 级别 | 条件 | 动作 |
|------|------|------|
| L1 | 单信号黄 | 值班自愈 + 记 ops event |
| L2 | 红且可玩降级 | 开 mock/silent，修上游 |
| L3 | 桥接死或全站 5xx | 停量 → 修 Fusion/Infi → 再放量 |

---
*W9 · polly 落地 · 与 `/api/ops` 同源*
