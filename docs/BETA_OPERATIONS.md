# OpenSupportAI Beta Operational Qualification

This document defines the operational evidence required for the supported public Beta topology: PostgreSQL/pgvector, one migration task, one API process, and one worker process.

## Evidence Levels

OpenSupportAI keeps three evidence levels separate:

1. Local or developer smoke checks prove that a probe can reach a running environment.
2. GitHub CI runs the production Compose topology and proves container, migration, bounded-load, fault, queue-recovery, backup, and restore behavior.
3. A release-qualifying staging soak proves continuous low-volume operation for at least 24 measured hours.

A short CI soak validates the harness only. It always reports `qualified_for_beta=false`.

## Required Fixture

The load and recovery probes require a project, inbox, public key, indexed knowledge, and a root admin token. The production Compose smoke explicitly seeds its disposable database after startup. Normal production startup never seeds demo data.

The provider-fault probe changes the active LLM and creates an active disposable tool. Run it only against an isolated project or database that will be reset after the test.

## Bounded Load

```bash
API_URL=https://api.staging.example.com \
ADMIN_TOKEN=replace_with_staging_root_token \
LOAD_CONVERSATIONS=8 \
LOAD_CONCURRENCY=4 \
LOAD_REPORT_PATH=output/beta-evidence/load.json \
pnpm smoke:load
```

The probe races two requests with the same idempotency key for every conversation and message. It then requires exactly one conversation, one end-user message, one answer, and one completed `answer.generate` job per flow. It reports p50, p95, and maximum creation, acceptance, and answer latency.

Default gates:

- message acceptance p95 at or below 2 seconds;
- answer completion p95 at or below 60 seconds;
- zero duplicate messages;
- zero unexpected job retries.

## Provider Faults

```bash
API_URL=https://api.staging.example.com \
ADMIN_TOKEN=replace_with_staging_root_token \
FAULT_REPORT_PATH=output/beta-evidence/faults.json \
pnpm smoke:faults
```

The LLM outage case uses an unreachable provider and requires a completed deterministic grounded fallback, preserved citations, and persisted `llm_fallback` plus error evidence. The tool outage case uses an unreachable allowlisted endpoint and requires a failed tool call plus a bounded user-facing answer.

## Worker Queue Recovery

The production Compose smoke owns the stop/start sequence. While readiness reports `worker_stale`, the enqueue phase requires API liveness and persists several accepted messages with queued answer jobs. After the worker restarts, the verify phase requires one answer per source message, completed jobs, and no additional attempts.

```bash
WORKER_RECOVERY_STATE_PATH=/tmp/opensupportai-worker-recovery.json \
API_URL=https://api.staging.example.com ADMIN_TOKEN=... \
pnpm smoke:worker-recovery enqueue

WORKER_RECOVERY_STATE_PATH=/tmp/opensupportai-worker-recovery.json \
API_URL=https://api.staging.example.com ADMIN_TOKEN=... \
pnpm smoke:worker-recovery verify
```

The state file is temporary operational evidence and can contain internal record identifiers. Do not commit it.

## 24-Hour Soak

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

Each cycle checks readiness, creates a conversation, accepts one grounded message, waits for exactly one answer, and records authenticated queue and process-memory metrics. The report is replaced atomically after every cycle so an interrupted run retains useful evidence.

Default release gates:

- at least 86,400 measured seconds;
- at least 95 percent of the configured cycle cadence, which is 1,368 cycles at one cycle per minute;
- zero failed cycles, duplicate messages, and readiness failures;
- message acceptance p95 at or below 2 seconds;
- answer completion p95 at or below 30 seconds;
- API resident-memory growth at or below 256 MiB.
- a declared source revision in `provenance.revision` that matches the deployed release candidate.

Only a report with `status=passed`, `thresholds_passed=true`, and `qualified_for_beta=true` can gate a Beta release. Keep the raw report as a GitHub prerelease asset rather than committing it to source.

## Known Boundary

The Beta qualification proves the documented single-API, single-worker topology. It does not prove distributed rate limiting, shared live-event delivery, or a global concurrency quota across multiple replicas. Mutation tools remain outside the durable worker path.
