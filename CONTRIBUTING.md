# Contributing to OpenSupportAI

欢迎参与 OpenSupportAI。

## v0.1 优先方向

```text
Conversation API
SDK / Widget
LLM Adapter
RAG Knowledge Service
Chatwoot Adapter
Admin Console
Docker Compose demo
测试和文档
```

## 开发命令

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## PR 要求

每个 PR 必须包含：

```text
目的
改动范围
测试方式
验收标准
文档更新
```

## 代码原则

```text
TypeScript strict
共享类型放 packages/protocol
所有输入做 schema validation
前端不暴露 secret
所有多租户查询带 project_id
外部 API 调用设置 timeout
```

## 不接受的改动

```text
把 LLM Key 放进前端
无知识命中时让 AI 编造
绕过 project_id 隔离
直接复制第三方项目源码
大范围重构但没有测试
```
