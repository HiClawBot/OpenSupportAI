# OpenSupportAI Roadmap

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
pgvector Retrieval
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
Generic Webhook Adapter
Mobile SDK 方案
```

---

## v1.0：稳定发行

目标：稳定 API、稳定 SDK、稳定部署方案。

### 范围

```text
稳定 REST API
稳定 SSE protocol
稳定 SDK API
稳定 Widget embed API
Helm Chart
性能压测
安全测试
迁移策略
插件系统
完整文档站
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
