# OpenSupportAI Roadmap

## 当前成熟度与愿景对齐

OpenSupportAI 的核心定位是“可嵌入、自托管、可接管、可治理进化的 AI 客服运行时”，而不是完整 CRM 或全渠道工单平台。

当前公开 tag 为 `v1.0.0`，公共 API/SDK/Widget 契约已经稳定；但代码成熟度应定义为可控 staging candidate，不应描述为无人值守生产就绪。下一条公开成熟度发布线计划为 `v1.1.0-beta.1`。

Beta 支持范围保持收敛：

```text
一个 API + 一个 worker + PostgreSQL/pgvector
Web Widget 与 Headless SDK
一个 OpenAI-compatible provider
Markdown/Text 知识源
只读业务工具
Generic webhook 入站
可选 Chatwoot 人工接管
确定性质量门禁与人工治理进化
```

Beta 明确不承诺：多 API 横向扩展、自动 mutation tool、Email/Telegram 完整 provider、URL/PDF 生产采集、全自治进化、完整 CRM。

## Beta 施工状态

### 已完成

- 生产配置 fail-fast、conversation capability、短期 SSE token、显式 admin scope 和统一出站网络防护。
- PostgreSQL 原子 job claim、lease、heartbeat、stale recovery、owner fencing、幂等消息/会话和持久化回答 worker。
- 非 root 生产镜像、one-shot migration、readiness、worker loss 检测、备份恢复和 CI Compose 演练。
- 七场景关键 golden corpus、确定性 CI 阈值、持久化 evaluation evidence，以及带人工审批、回归、灰度、晋级和回滚的提案状态机。
- Admin Console 治理工作区；生产 root token 不持久化，proposal 不自动修改生产状态。

### `v1.1.0-beta.1` 发布前剩余

1. 用有界 PostgreSQL 全文/词法检索替换 Prisma broad substring scan，校准阈值、引用和 no-hit。
2. 补齐 Widget locale、错误恢复和 Governance 浏览器自动化覆盖。
3. 执行低流量 load test、LLM/tool/worker fault injection、恢复演练和 24 小时 staging soak。
4. 关闭全部 P0/P1，生成双语 release notes、checksums/SBOM 和可追溯发布证据。

发布原则：模型可以提出候选改进，但不能审批自己的变更，也不能绕过回归、灰度和回滚门禁直接修改生产状态。

---

## v0.1：端到端闭环

目标：让开发者可以本地运行 demo，并完成 AI 问答 + 转人工闭环。

### 范围

```text
Web Widget
Headless JS SDK
Conversation API
SSE events
OpenAI-compatible LLM Adapter
Markdown/Text Knowledge Ingestion
Keyword Retrieval（pgvector schema 已准备，生产词法检索仍在施工）
AI Orchestrator
Chatwoot Adapter
Admin Console 简版
Docker Compose demo
基础测试和文档
```

### 验收

```text
Demo App 可嵌入 Widget
用户可提问
AI 可基于知识库回答
无知识命中不编造
用户可转人工
Chatwoot 可接收会话
坐席回复可回到 Widget
Admin 可配置项目/LLM/知识库/Chatwoot
```

---

## v0.2：生产化基础

目标：让项目具备早期真实自托管可用性。

### 范围

```text
组织成员和权限
API key 管理
更完善 Admin Console
Webhook 管理
异步任务重试
Langfuse integration
RAGFlow adapter
Qdrant adapter
更完善错误处理
审计日志
Rate limit
Token budget
```

---

## v0.3：业务工具调用

目标：让 AI 客服可以安全查询业务系统。

### 范围

```text
OpenAPI Tool Connector
Tool allowlist
Tool permission
用户身份透传
高风险操作二次确认
订单查询 demo
订阅状态 demo
退款申请草稿 demo
工具调用日志
```

---

## v0.4：坐席辅助

目标：增强人工客服效率。

### 范围

```text
AI conversation summary
AI suggested reply
情绪识别
自动标签
自动分流
handoff reason analytics
CSAT 分析
坐席反馈回流到评测集
```

---

## v0.5：多渠道与适配器

目标：成为更通用的 AI 客服接入层。

### 范围

```text
Tiledesk Adapter
Zammad Adapter
Slack Adapter
Email Adapter
Telegram Adapter
Generic Webhook Adapter（v0.5.0 已提供入站版本）
Channel Adapter Catalog（v0.5.0 已提供）
Mobile SDK 方案
```

说明：v0.5.0 已落地 generic webhook 入站 adapter；Slack、Email、Telegram 当前是契约 stub，后续再接真实 provider API。

---

## v1.0：公共契约稳定发行（已发布）

目标：稳定 API、稳定 SDK、稳定部署方案。

说明：契约稳定表示兼容性边界已经冻结，不等同于运行时已达到无人值守生产就绪。生产成熟度继续由 Beta 发布门禁评估。

### 范围

```text
稳定 REST API（v1.0 已冻结）
稳定 SSE protocol（v1.0 已冻结）
稳定 SDK API（v1.0 已冻结）
稳定 Widget embed API（v1.0 已冻结）
稳定 adapter/tool execution 契约（v1.0 已冻结）
升级指南（v1.0 已提供）
生产部署指南（v1.0 已提供）
安全硬化清单（v1.0 已提供）
发布验证清单（持续维护）
```

### v1.x 后续方向

```text
Helm Chart
性能压测报告
更完整的观测集成
有界 PostgreSQL 词法检索与后续 hybrid/vector retrieval
评测趋势与 release evidence dashboard
自动化 canary 指标采集（仍保留人工审批）
自动 OpenAPI spec import
高风险工具人工审批流
Slack 出站回复
Email/Telegram 真实 provider API
完整文档站
插件系统
```

---

## 明确暂不进入路线图的内容

```text
完整 CRM
营销自动化
复杂呼叫中心
社媒全渠道收件箱
私有模型训练平台
复杂可视化 Agent Studio
```

这些能力可以通过适配器或生态系统接入，而不是进入核心。
