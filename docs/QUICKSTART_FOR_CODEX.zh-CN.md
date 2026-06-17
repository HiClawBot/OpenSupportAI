# 给 Codex 的最短启动说明

请先阅读：

```text
README.md
docs/CONSTRUCTION.zh-CN.md
docs/CODEX_TASKS.zh-CN.md
docs/API_SPEC.zh-CN.md
docs/DATA_MODEL.zh-CN.md
```

然后按顺序执行：

```text
PR-001 → PR-002 → PR-003 → PR-004 → PR-005 → PR-006 → PR-007 → PR-008 → PR-009 → PR-010 → PR-011 → PR-012
```

第一条任务：

```text
初始化 TypeScript monorepo，创建 pnpm workspace、Turborepo、基础包结构、Docker Compose skeleton、README、LICENSE、CONTRIBUTING、SECURITY，并保证 pnpm install/lint/test/build 可运行。
```

不要先实现复杂功能。先把仓库跑起来。
