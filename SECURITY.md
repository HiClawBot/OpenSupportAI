# Security Policy

OpenSupportAI 涉及客服会话、知识库、用户资料和外部集成 token。请不要在公开 issue 中披露安全漏洞细节。

## 报告漏洞

请通过项目维护者指定邮箱或私有安全报告渠道提交：

```text
security@example.com
```

请包含：

```text
影响版本
漏洞描述
复现步骤
潜在影响
建议修复方式
```

## 安全基线

```text
前端不得暴露 LLM API Key
所有多租户查询必须带 project_id
Webhook 必须校验 secret/signature
Integration token 必须加密存储
API key 只保存 hash
AI 无知识命中时不应编造
OpenAPI business tool 必须使用 host allowlist、timeout 和默认 mutation guard
生产环境必须替换 demo admin token，并限制 CORS_ORIGIN
```

更多内容见 `docs/SECURITY.zh-CN.md`。
