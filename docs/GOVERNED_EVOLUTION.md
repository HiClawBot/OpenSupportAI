# Governed Evaluation and Evolution

OpenSupportAI treats self-improvement as an evidence and change-control workflow, not as permission for a model to edit production state. The current Beta foundation can record deterministic evaluation evidence and govern a proposed knowledge, prompt, or tool change through review, regression, canary, promotion, and rollback.

## Safety Boundary

- Evaluation is deterministic and versioned. No model judge decides a release gate.
- Every suite, run, result, and proposal is scoped to one project.
- Proposal artifacts are immutable evidence identified by a canonical SHA-256 hash.
- All write and transition APIs require the `admin:evolution` scope.
- Every creation and transition writes an audit event without logging the artifact payload.
- A proposal never edits production knowledge, prompts, tool definitions, or provider configuration automatically.
- Production application remains an explicit operator or deployment-system action outside this workflow.

## Runtime Flow

```text
versioned suite + trusted observations
                 |
                 v
        deterministic evaluation run
                 |
          failed evidence only
                 v
              draft
          /             \
     rejected         approved
                         |
              new passing regression run
                         |
                 regression_passed
                         |
          canary evidence + rollback target
                         |
                       canary
                    /          \
              promoted       rolled_back
                  |
             rolled_back
```

The source run cannot be reused as regression evidence. A valid regression run must use the same suite and version, pass all configured thresholds, and be created after approval.

## Deterministic Contract

The evaluator package is `@opensupportai/evals`. Evaluator version `osa-deterministic-v1` supports these categories:

```text
faq
ambiguity
prompt_injection
missing_identity
tool_failure
llm_failure
handoff
```

Expectations can constrain the classified outcome, conversation status, AI run status, citation count, handoff count, tool-call status, answer metadata, and required or forbidden answer text. A run passes only when its score and pass rate meet the suite thresholds and every critical scenario passes when `require_critical_pass` is enabled.

The repository includes a critical golden corpus at `evals/golden/beta-core.v1.json`. It executes the real memory repository and orchestrator, including bounded tool and model failure fixtures:

```bash
pnpm eval:golden
```

## Persistent Evidence

The PostgreSQL and memory repositories implement these records:

- `EvaluationSuite`: immutable suite identity, version, evaluator version, thresholds, and scenarios.
- `EvaluationScenario`: ordered input, expectations, category, and criticality.
- `EvaluationRun`: suite snapshot, aggregate score, pass rate, critical status, and summary evidence.
- `EvaluationResult`: per-scenario observations, assertions, outcome, score, and error evidence.
- `EvolutionProposal`: source evidence, proposed artifact, baseline, lifecycle status, review data, regression link, canary evidence, and rollback target.

The migration is `202607220004_governed_evolution`.

## Admin API

All endpoints require a root admin token or a project API key with `admin:evolution`:

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

Transition actions are:

```text
approve
reject
record_regression
start_canary
promote
rollback
```

State conflicts, stale transitions, reused evidence, and invalid gates return HTTP `409`. Invalid request shapes return HTTP `400`.

## Operator Console

The Admin Console Governance workspace lists suites, runs, critical failures, and proposals. Operators can draft proposals from failed evidence, approve or reject them, select an eligible passing regression run, start a canary with rollback data, promote a passed canary, or record a rollback.

The root token is held only in React memory. Production builds start with an empty token, and a page reload clears it. The demo token is available only in development mode.

## PostgreSQL Smoke Test

After applying migrations and seed data to a disposable PostgreSQL database:

```bash
DATABASE_URL=postgresql://... pnpm smoke:postgres-evolution
```

The smoke test creates a failed source run, drafts and approves a proposal, records a new passing regression run, starts a canary, promotes, rolls back, verifies the final state, and removes its temporary records.

## Current Beta Limitations

- Evaluation observations are submitted by a trusted runner or administrator. The API does not remotely execute arbitrary scenario input.
- The website Scenario Lab is a browser-only demonstrator and is not the release-gating runner.
- Proposal artifacts are evidence only; there is no automatic apply, deployment, or production mutation path.
- Canary evidence is operator-supplied structured metadata. Automated traffic allocation and metric ingestion remain future work.
- The deterministic corpus covers critical safety branches but is not yet a domain-specific customer acceptance suite.
- The current CI golden gate reports to job output; long-term trend storage and release dashboards remain future work.

These limitations are deliberate. They preserve auditability and operator control while the evaluation corpus, retrieval quality, and production reliability evidence mature.
