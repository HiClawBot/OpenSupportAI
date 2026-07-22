#!/usr/bin/env node

import {
  adminHeaders,
  assert,
  booleanEnvironment,
  conversationHeaders,
  integerEnvironment,
  latencySummary,
  projectHeaders,
  requestJson,
  round,
  runtimeSettings,
  sleep,
  uniqueRunId,
  waitFor,
  writeJsonAtomic
} from "./lib/beta-runtime.mjs";

const help = `OpenSupportAI low-volume Beta soak

Runs one complete conversation/answer probe per interval and persists an atomic
JSON report after every cycle. A report is release-qualifying only when the
actual elapsed duration is at least 24 hours and every configured threshold passes.

Environment:
  API_URL=http://127.0.0.1:4000
  ADMIN_TOKEN=required (or ADMIN_API_TOKEN)
  SOAK_DURATION_SECONDS=86400
  SOAK_INTERVAL_MS=60000
  SOAK_ANSWER_TIMEOUT_MS=30000
  SOAK_MAX_FAILURES=0
  SOAK_ACCEPT_P95_MS=2000
  SOAK_ANSWER_P95_MS=30000
  SOAK_MAX_RSS_GROWTH_BYTES=268435456
  SOAK_MIN_CYCLES=derived as 95% of the configured cadence
  SOAK_REVISION=required source revision for a release-qualifying run
  SOAK_ENVIRONMENT=optional environment label
  SOAK_REPORT_PATH=required for a release-qualifying run
  SOAK_REQUIRE_24_HOURS=false (set true for release execution)
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

const settings = runtimeSettings();
const durationSeconds = integerEnvironment(process.env, "SOAK_DURATION_SECONDS", 86_400);
const intervalMs = integerEnvironment(process.env, "SOAK_INTERVAL_MS", 60_000, 250);
const answerTimeoutMs = integerEnvironment(process.env, "SOAK_ANSWER_TIMEOUT_MS", 30_000);
const maxFailures = integerEnvironment(process.env, "SOAK_MAX_FAILURES", 0, 0);
const acceptP95LimitMs = integerEnvironment(process.env, "SOAK_ACCEPT_P95_MS", 2_000);
const answerP95LimitMs = integerEnvironment(process.env, "SOAK_ANSWER_P95_MS", 30_000);
const maxRssGrowthBytes = integerEnvironment(
  process.env,
  "SOAK_MAX_RSS_GROWTH_BYTES",
  256 * 1024 * 1024,
  0
);
const minCycles = integerEnvironment(
  process.env,
  "SOAK_MIN_CYCLES",
  Math.max(1, Math.floor(((durationSeconds * 1000) / intervalMs) * 0.95))
);
const require24Hours = booleanEnvironment(process.env, "SOAK_REQUIRE_24_HOURS", false);
const revision = process.env["SOAK_REVISION"]?.trim();
const environment = process.env["SOAK_ENVIRONMENT"]?.trim();
const reportPath = process.env["SOAK_REPORT_PATH"];
if (require24Hours) assert(reportPath, "SOAK_REPORT_PATH is required for a qualifying run");
if (require24Hours) assert(durationSeconds >= 86_400, "A qualifying soak must target 24 hours");
if (require24Hours) assert(revision, "SOAK_REVISION is required for a qualifying run");

const runId = process.env["SOAK_RUN_ID"] ?? uniqueRunId("beta_soak");
const startedAt = new Date();
const startedAtMs = Date.now();
const deadlineMs = startedAtMs + durationSeconds * 1000;
const cycles = [];
let interrupted = false;
let interruptionSignal;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    interruptionSignal = signal;
  });
}

await main().catch(async (error) => {
  const report = buildReport("failed", error instanceof Error ? error.message : String(error));
  await persistReport(report);
  console.error(JSON.stringify(report));
  process.exitCode = 1;
});

async function main() {
  while (Date.now() < deadlineMs && !interrupted) {
    const cycleNumber = cycles.length + 1;
    const cycleStartedAt = Date.now();
    try {
      cycles.push(await runCycle(cycleNumber));
    } catch (error) {
      cycles.push({
        cycle: cycleNumber,
        started_at: new Date(cycleStartedAt).toISOString(),
        finished_at: new Date().toISOString(),
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const failures = cycles.filter((cycle) => cycle.status === "failed").length;
    const interimStatus = failures > maxFailures ? "failed" : "running";
    const interimReport = buildReport(interimStatus);
    await persistReport(interimReport);
    console.log(
      JSON.stringify({
        kind: "beta_soak_progress",
        run_id: runId,
        cycle: cycleNumber,
        status: cycles.at(-1)?.status,
        successes: cycles.length - failures,
        failures,
        elapsed_seconds: interimReport.elapsed_seconds
      })
    );
    if (failures > maxFailures) {
      throw new Error(`Soak failure budget exceeded: ${failures} > ${maxFailures}`);
    }

    const remainingMs = deadlineMs - Date.now();
    if (remainingMs > 0 && !interrupted) {
      await sleep(Math.min(intervalMs, remainingMs));
    }
  }

  const status = interrupted ? "interrupted" : "passed";
  const report = buildReport(status, interrupted ? `Received ${interruptionSignal}` : undefined);
  await persistReport(report);
  console.log(JSON.stringify(report));
  if (
    status !== "passed" ||
    !report.thresholds_passed ||
    (require24Hours && !report.qualified_for_beta)
  ) {
    process.exitCode = 1;
  }
}

async function runCycle(cycleNumber) {
  const cycleStartedAt = new Date();
  const ready = await requestJson(settings, "GET", "/health/ready");
  assert(ready.payload.status === "ready", `Cycle ${cycleNumber} readiness failed`);
  const cycleId = `${runId}:${cycleNumber}`;
  const conversation = await requestJson(settings, "POST", "/v1/client/conversations", {
    headers: projectHeaders(settings, { "Idempotency-Key": `${cycleId}:conversation` }),
    body: {
      project_id: settings.projectId,
      inbox_id: settings.inboxId,
      contact: {
        external_user_id: `${runId}-${cycleNumber}`,
        name: `Beta soak ${runId}`
      },
      metadata: { operational_probe: "soak", run_id: runId, cycle: cycleNumber }
    }
  });
  const conversationId = conversation.payload.conversation_id;
  const token = conversation.payload.conversation_token;
  const acceptanceStartedAt = performance.now();
  const accepted = await requestJson(
    settings,
    "POST",
    `/v1/client/conversations/${conversationId}/messages`,
    {
      headers: conversationHeaders(token, { "Idempotency-Key": `${cycleId}:message` }),
      body: { type: "text", text: "怎么取消订阅？" }
    }
  );
  assert(accepted.payload.status === "accepted", `Cycle ${cycleNumber} message was not accepted`);
  const acceptanceLatencyMs = performance.now() - acceptanceStartedAt;
  const answerStartedAt = performance.now();
  const messages = await waitFor(
    async () => {
      const response = await requestJson(
        settings,
        "GET",
        `/v1/client/conversations/${conversationId}/messages?limit=10`,
        { headers: conversationHeaders(token) }
      );
      return response.payload.messages?.some((message) => message.role === "ai_agent")
        ? response.payload.messages
        : undefined;
    },
    { timeoutMs: answerTimeoutMs, intervalMs: 500, description: `cycle ${cycleNumber} answer` }
  );
  const answerLatencyMs = performance.now() - answerStartedAt;
  assert(
    messages.filter((message) => message.role === "end_user").length === 1,
    `Cycle ${cycleNumber} has duplicate end-user messages`
  );
  assert(
    messages.filter((message) => message.role === "ai_agent").length === 1,
    `Cycle ${cycleNumber} has missing or duplicate answers`
  );
  const metrics = await requestJson(settings, "GET", "/v1/admin/ops/metrics", {
    headers: adminHeaders(settings)
  });
  assert(metrics.payload.runtime?.status === "ready", `Cycle ${cycleNumber} metrics are degraded`);

  return {
    cycle: cycleNumber,
    started_at: cycleStartedAt.toISOString(),
    finished_at: new Date().toISOString(),
    status: "passed",
    conversation_id: conversationId,
    message_id: accepted.payload.message_id,
    acceptance_latency_ms: round(acceptanceLatencyMs),
    answer_latency_ms: round(answerLatencyMs),
    api_rss_bytes: metrics.payload.process?.resident_memory_bytes ?? 0,
    queue: metrics.payload.runtime?.checks?.queue ?? null
  };
}

function buildReport(status, error) {
  const finishedAt = new Date();
  const successful = cycles.filter((cycle) => cycle.status === "passed");
  const failed = cycles.filter((cycle) => cycle.status === "failed");
  const acceptanceLatency = successful.map((cycle) => cycle.acceptance_latency_ms);
  const answerLatency = successful.map((cycle) => cycle.answer_latency_ms);
  const rssSamples = successful.map((cycle) => cycle.api_rss_bytes).filter((value) => value > 0);
  const initialRss = rssSamples[0] ?? 0;
  const maximumRss = Math.max(...rssSamples, 0);
  const rssGrowth = Math.max(0, maximumRss - initialRss);
  const elapsedSeconds = round((finishedAt.getTime() - startedAtMs) / 1000);
  const acceptance = latencySummary(acceptanceLatency);
  const answer = latencySummary(answerLatency);
  const thresholdsPassed =
    failed.length <= maxFailures &&
    successful.length >= minCycles &&
    acceptance.p95_ms <= acceptP95LimitMs &&
    answer.p95_ms <= answerP95LimitMs &&
    rssGrowth <= maxRssGrowthBytes;
  const elapsed24Hours = elapsedSeconds >= 86_400;

  return {
    schema_version: 1,
    kind: "beta_soak",
    run_id: runId,
    status,
    thresholds_passed: thresholdsPassed,
    qualified_for_beta: status === "passed" && thresholdsPassed && elapsed24Hours,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    provenance: {
      revision: revision ?? null,
      environment: environment ?? null
    },
    target_duration_seconds: durationSeconds,
    elapsed_seconds: elapsedSeconds,
    interval_ms: intervalMs,
    thresholds: {
      max_failures: maxFailures,
      accept_p95_ms: acceptP95LimitMs,
      answer_p95_ms: answerP95LimitMs,
      max_rss_growth_bytes: maxRssGrowthBytes,
      min_cycles: minCycles,
      minimum_release_duration_seconds: 86_400
    },
    summary: {
      cycles: cycles.length,
      passed: successful.length,
      failed: failed.length,
      availability: cycles.length === 0 ? 0 : round(successful.length / cycles.length),
      duplicate_messages: 0,
      readiness_failures: failed.filter((cycle) => cycle.error?.includes("readiness")).length
    },
    latency: {
      message_acceptance: acceptance,
      answer_completion: answer
    },
    process_memory: {
      initial_rss_bytes: initialRss,
      maximum_rss_bytes: maximumRss,
      growth_bytes: rssGrowth
    },
    ...(error ? { error } : {}),
    cycles
  };
}

async function persistReport(report) {
  if (reportPath) await writeJsonAtomic(reportPath, report);
}
