# 治理评测与进化

OpenSupportAI 将自我进化定义为证据和变更控制流程，而不是允许模型直接修改生产状态。当前 Beta 基础可以记录确定性评测证据，并通过审核、回归、灰度、晋级和回滚治理知识、提示词或工具提案。

## 安全边界

- 评测器是确定性且版本化的；发布门禁不由模型裁判决定。
- 每个评测套件、运行、结果和提案都严格归属于单一项目。
- 提案内容是不可变证据，并使用规范化 SHA-256 hash 标识。
- 所有写入和状态变更 API 都要求 `admin:evolution` 权限。
- 每次创建和状态变更都会写入审计事件，但不会把提案内容写入审计日志。
- 提案不会自动修改生产知识库、提示词、工具定义或 provider 配置。
- 生产应用仍是该工作流之外的显式 operator 或部署系统动作。

## 运行流程

```text
版本化套件 + 可信 observations
                 |
                 v
            确定性评测运行
                 |
            仅使用失败证据
                 v
                草稿
          /             \
       已拒绝          已批准
                         |
               新的通过回归运行
                         |
                     回归通过
                         |
              灰度证据 + 回滚目标
                         |
                       灰度
                    /          \
                 已晋级        已回滚
                    |
                 已回滚
```

源运行不能被复用为回归证据。有效回归运行必须使用相同套件和版本，通过全部阈值，并在批准操作之后创建。

## 确定性契约

评测器包为 `@opensupportai/evals`。评测器版本 `osa-deterministic-v1` 支持以下类别：

```text
faq
ambiguity
prompt_injection
missing_identity
tool_failure
llm_failure
handoff
```

期望条件可以约束分类结果、会话状态、AI run 状态、引用数量、转接数量、tool-call 状态、回答 metadata，以及回答必须包含或禁止包含的文本。只有总分和通过率达到套件阈值，并且在启用 `require_critical_pass` 时全部关键场景通过，运行才会通过。

仓库在 `evals/golden/beta-core.v1.json` 提供关键 golden corpus。它会执行真实内存 repository 和 orchestrator，并注入有界的工具与模型失败场景：

```bash
pnpm eval:golden
```

## 持久化证据

PostgreSQL 与内存 repository 均实现以下记录：

- `EvaluationSuite`：不可变的套件标识、版本、评测器版本、阈值和场景。
- `EvaluationScenario`：有序输入、期望条件、类别和关键性。
- `EvaluationRun`：套件快照、总分、通过率、关键场景状态和 summary 证据。
- `EvaluationResult`：单场景 observations、断言、结果、得分和错误证据。
- `EvolutionProposal`：源证据、提案内容、baseline、生命周期状态、审核数据、回归关联、灰度证据和回滚目标。

对应 migration 为 `202607220004_governed_evolution`。

## 管理 API

全部 endpoint 都要求 root admin token，或具有 `admin:evolution` 权限的项目 API key：

```text
GET    /v1/admin/projects/{project_id}/evaluations/suites
POST   /v1/admin/projects/{project_id}/evaluations/suites
GET    /v1/admin/projects/{project_id}/evaluations/runs
GET    /v1/admin/projects/{project_id}/evaluations/runs/{run_id}
POST   /v1/admin/projects/{project_id}/evaluations/runs
GET    /v1/admin/projects/{project_id}/evolution/proposals
POST   /v1/admin/projects/{project_id}/evolution/proposals
POST   /v1/admin/projects/{project_id}/evolution/proposals/{proposal_id}/transitions
```

支持的状态变更动作：

```text
approve
reject
record_regression
start_canary
promote
rollback
```

状态冲突、过期变更、复用证据和不满足门禁时返回 HTTP `409`；请求格式无效时返回 HTTP `400`。

## Operator Console

Admin Console 的 Governance 工作区会列出套件、运行、关键失败和提案。Operator 可以从失败证据创建提案、批准或拒绝提案、选择符合条件的新回归运行、带回滚数据启动灰度、晋级已通过灰度的提案，或记录回滚。

Root token 仅保存在 React 内存中。生产构建默认 token 为空，刷新页面后 token 会被清除；demo token 只在开发模式可用。

## PostgreSQL Smoke Test

在临时 PostgreSQL 数据库完成 migration 和 seed 后执行：

```bash
DATABASE_URL=postgresql://... pnpm smoke:postgres-evolution
```

测试会创建失败源运行，创建并批准提案，记录新的通过回归运行，启动灰度、晋级、回滚，验证最终状态，并删除临时记录。

## 当前 Beta 限制

- 评测 observations 由可信 runner 或管理员提交；API 不会远程执行任意场景输入。
- 官网 Scenario Lab 是浏览器内示范工具，不是发布门禁 runner。
- 提案内容仅是证据；当前没有自动 apply、部署或生产 mutation 路径。
- 灰度证据是 operator 提交的结构化 metadata；自动流量分配和指标采集仍是后续工作。
- 当前确定性语料覆盖关键安全分支，但还不是面向具体客户领域的验收套件。
- 当前 CI golden gate 将结果输出到 job log；长期趋势存储和发布 dashboard 仍是后续工作。

这些限制是有意保留的，用于在评测语料、检索质量和生产可靠性证据继续成熟时，保持可审计性和 operator 控制。

英文版见 [Governed Evaluation and Evolution](./GOVERNED_EVOLUTION.md)。
