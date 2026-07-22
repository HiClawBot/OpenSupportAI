# OpenSupportAI Beta 运维验收

本文定义公开 Beta 支持拓扑所需的运维证据。该拓扑由 PostgreSQL/pgvector、一次性 migration task、一个 API 进程和一个 worker 进程组成。

## 证据层级

OpenSupportAI 明确区分三层证据：

1. 本地或开发 smoke 证明探针能够访问运行环境。
2. GitHub CI 使用生产 Compose，证明容器、migration、有界负载、故障回退、队列恢复、备份和恢复行为。
3. 满足发布条件的 staging soak 证明至少连续 24 小时的低流量运行。

短时 CI soak 只验证工具本身，报告中的 `qualified_for_beta` 必须为 `false`。

## 必需测试数据

负载与恢复探针需要项目、inbox、public key、已索引知识和 root admin token。生产 Compose smoke 会在启动后显式向一次性数据库写入测试数据；普通生产启动永远不会自动写入 demo 数据。

Provider 故障探针会修改 active LLM，并创建一个 active 的一次性工具。该命令只能在隔离项目或测试后会重置的数据库中运行。

## 有界负载

```bash
API_URL=https://api.staging.example.com \
ADMIN_TOKEN=replace_with_staging_root_token \
LOAD_CONVERSATIONS=8 \
LOAD_CONCURRENCY=4 \
LOAD_REPORT_PATH=output/beta-evidence/load.json \
pnpm smoke:load
```

探针会为每个会话和消息并发发送两个相同幂等键的请求，然后要求每条流程只存在一个会话、一条用户消息、一条回答和一个已完成的 `answer.generate` 任务。报告记录创建、接收和回答延迟的 p50、p95 与最大值。

默认门禁：

- 消息接收 p95 不超过 2 秒。
- 回答完成 p95 不超过 60 秒。
- 重复消息为 0。
- 非预期任务重试为 0。

## Provider 故障

```bash
API_URL=https://api.staging.example.com \
ADMIN_TOKEN=replace_with_staging_root_token \
FAULT_REPORT_PATH=output/beta-evidence/faults.json \
pnpm smoke:faults
```

LLM 故障场景使用不可达 provider，要求确定性知识回退完成、引用得到保留，并持久化 `llm_fallback` 和错误证据。工具故障场景使用不可达但已加入允许列表的地址，要求写入失败 tool call，并向用户返回有界失败提示。

## Worker 队列恢复

生产 Compose smoke 负责停止和启动 worker。Readiness 报告 `worker_stale` 时，enqueue 阶段要求 API 仍然存活，并把多条已接收消息及其回答任务持久化为 queued。Worker 重启后，verify 阶段要求每条源消息只有一个回答、任务全部完成且没有额外 attempt。

```bash
WORKER_RECOVERY_STATE_PATH=/tmp/opensupportai-worker-recovery.json \
API_URL=https://api.staging.example.com ADMIN_TOKEN=... \
pnpm smoke:worker-recovery enqueue

WORKER_RECOVERY_STATE_PATH=/tmp/opensupportai-worker-recovery.json \
API_URL=https://api.staging.example.com ADMIN_TOKEN=... \
pnpm smoke:worker-recovery verify
```

状态文件属于临时运维证据，可能包含内部记录标识，不应提交到源码仓库。

## 24 小时 Soak

```bash
SOAK_DURATION_SECONDS=86400 \
SOAK_INTERVAL_MS=60000 \
SOAK_REQUIRE_24_HOURS=true \
SOAK_REVISION=$(git rev-parse HEAD) \
SOAK_ENVIRONMENT=staging \
SOAK_REPORT_PATH=output/beta-evidence/soak.json \
API_URL=https://api.staging.example.com \
ADMIN_TOKEN=replace_with_staging_root_token \
pnpm soak:beta
```

每个周期都会检查 readiness、创建会话、接收一条知识问题、等待唯一回答，并记录经过鉴权的队列与进程内存指标。每个周期完成后都会原子替换报告，因此运行被中断时仍能保留有效证据。

默认发布门禁：

- 实际运行时间不少于 86400 秒。
- 完成数量不少于配置周期数的 95%；每分钟一次时至少完成 1368 个周期。
- 失败周期、重复消息和 readiness failure 均为 0。
- 消息接收 p95 不超过 2 秒。
- 回答完成 p95 不超过 30 秒。
- API 常驻内存增长不超过 256 MiB。
- `provenance.revision` 声明的源码 revision 与实际部署的候选版本一致。

只有同时满足 `status=passed`、`thresholds_passed=true` 和 `qualified_for_beta=true` 的报告才能作为 Beta 发布门禁。原始报告应作为 GitHub prerelease 资产保存，不提交到源码仓库。

## 已知边界

Beta 验收只证明文档声明的单 API、单 worker 拓扑，不证明多副本之间的分布式限流、共享实时事件投递或全局并发配额。Mutation tool 仍不进入可重试的 durable worker 路径。
