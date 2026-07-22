#!/usr/bin/env node

import {
  adminHeaders,
  assert,
  conversationHeaders,
  integerEnvironment,
  latencySummary,
  projectHeaders,
  requestJson,
  runWithConcurrency,
  runtimeSettings,
  uniqueRunId,
  waitFor,
  writeJsonAtomic
} from "./lib/beta-runtime.mjs";

const help = `OpenSupportAI bounded Beta load smoke

Exercises a running Prisma/worker deployment through the public API:
- races idempotent conversation creation and message acceptance
- waits for durable worker answers
- verifies exactly one end-user message, answer, and completed answer job
- reports acceptance and answer-completion latency percentiles

Environment:
  API_URL=http://127.0.0.1:4000
  ADMIN_TOKEN=required (or ADMIN_API_TOKEN)
  PROJECT_ID=proj_demo
  PUBLIC_KEY=pk_demo
  INBOX_ID=inbox_default
  LOAD_CONVERSATIONS=8
  LOAD_CONCURRENCY=4
  LOAD_TIMEOUT_MS=60000
  LOAD_ACCEPT_P95_MS=2000
  LOAD_ANSWER_P95_MS=60000
  LOAD_REPORT_PATH=optional JSON output path
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

const settings = runtimeSettings();
const conversationCount = integerEnvironment(process.env, "LOAD_CONVERSATIONS", 8);
const concurrency = integerEnvironment(process.env, "LOAD_CONCURRENCY", 4);
const timeoutMs = integerEnvironment(process.env, "LOAD_TIMEOUT_MS", 60_000);
const acceptP95LimitMs = integerEnvironment(process.env, "LOAD_ACCEPT_P95_MS", 2_000);
const answerP95LimitMs = integerEnvironment(process.env, "LOAD_ANSWER_P95_MS", 60_000);
const runId = process.env["LOAD_RUN_ID"] ?? uniqueRunId("beta_load");
const reportPath = process.env["LOAD_REPORT_PATH"];
const startedAt = new Date();

await main().catch(async (error) => {
  const report = {
    schema_version: 1,
    kind: "beta_load",
    run_id: runId,
    status: "failed",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error)
  };
  if (reportPath) await writeJsonAtomic(reportPath, report);
  console.error(JSON.stringify(report));
  process.exitCode = 1;
});

async function main() {
  const ready = await requestJson(settings, "GET", "/health/ready");
  assert(ready.payload.status === "ready", "Runtime readiness did not return ready");

  const indices = Array.from({ length: conversationCount }, (_, index) => index);
  const conversations = await runWithConcurrency(indices, concurrency, async (index) => {
    const conversationBody = {
      project_id: settings.projectId,
      inbox_id: settings.inboxId,
      contact: {
        external_user_id: `${runId}-${index}`,
        name: `Beta load ${runId}`,
        email: `${runId}-${index}@example.com`
      },
      metadata: { operational_probe: "load", run_id: runId, index }
    };
    const conversationKey = `${runId}:conversation:${index}`;
    const conversationStartedAt = performance.now();
    const created = await Promise.all(
      Array.from({ length: 2 }, () =>
        requestJson(settings, "POST", "/v1/client/conversations", {
          body: conversationBody,
          headers: projectHeaders(settings, { "Idempotency-Key": conversationKey })
        })
      )
    );
    const conversationIds = new Set(created.map((result) => result.payload.conversation_id));
    assert(
      conversationIds.size === 1,
      `Conversation ${index} was duplicated under idempotent race`
    );
    assertIdempotencyPair(created, `conversation ${index}`);
    const conversationId = created[0].payload.conversation_id;
    const conversationToken = created[0].payload.conversation_token;
    assert(typeof conversationId === "string", `Conversation ${index} has no id`);
    assert(typeof conversationToken === "string", `Conversation ${index} has no capability token`);
    const createLatencyMs = performance.now() - conversationStartedAt;

    const messageKey = `${runId}:message:${index}`;
    const acceptanceStartedAt = performance.now();
    const accepted = await Promise.all(
      Array.from({ length: 2 }, () =>
        requestJson(settings, "POST", `/v1/client/conversations/${conversationId}/messages`, {
          body: { type: "text", text: "怎么取消订阅？" },
          headers: conversationHeaders(conversationToken, { "Idempotency-Key": messageKey })
        })
      )
    );
    const messageIds = new Set(accepted.map((result) => result.payload.message_id));
    assert(messageIds.size === 1, `Message ${index} was duplicated under idempotent race`);
    assertIdempotencyPair(accepted, `message ${index}`);
    return {
      conversation_id: conversationId,
      conversation_token: conversationToken,
      message_id: accepted[0].payload.message_id,
      create_latency_ms: createLatencyMs,
      acceptance_latency_ms: performance.now() - acceptanceStartedAt,
      accepted_at_ms: performance.now()
    };
  });

  await waitFor(
    async () => {
      const response = await requestJson(
        settings,
        "GET",
        `/v1/admin/projects/${settings.projectId}/conversations?q=${encodeURIComponent(runId)}&limit=100`,
        { headers: adminHeaders(settings) }
      );
      const byId = new Map(
        (response.payload.conversations ?? []).map((conversation) => [
          conversation.id,
          conversation
        ])
      );
      return conversations.every((item) => {
        const conversation = byId.get(item.conversation_id);
        return conversation?.messageCount === 2 && conversation?.lastMessage?.role === "ai_agent";
      });
    },
    { timeoutMs, intervalMs: 500, description: `${conversationCount} durable answers` }
  );

  const verified = await runWithConcurrency(conversations, concurrency, async (item) => {
    const response = await requestJson(
      settings,
      "GET",
      `/v1/client/conversations/${item.conversation_id}/messages?limit=10`,
      { headers: conversationHeaders(item.conversation_token) }
    );
    const messages = response.payload.messages ?? [];
    const endUserMessages = messages.filter((message) => message.role === "end_user");
    const answers = messages.filter((message) => message.role === "ai_agent");
    assert(endUserMessages.length === 1, `${item.conversation_id} has duplicate end-user messages`);
    assert(answers.length === 1, `${item.conversation_id} has missing or duplicate answers`);
    assert(
      Array.isArray(answers[0].sourceRefs) && answers[0].sourceRefs.length > 0,
      `${item.conversation_id} answer has no knowledge citation`
    );
    return {
      ...item,
      answer_latency_ms: performance.now() - item.accepted_at_ms
    };
  });

  const jobsResponse = await requestJson(
    settings,
    "GET",
    `/v1/admin/projects/${settings.projectId}/jobs?type=answer.generate&limit=100`,
    { headers: adminHeaders(settings) }
  );
  const conversationIds = new Set(verified.map((item) => item.conversation_id));
  const jobs = (jobsResponse.payload.jobs ?? []).filter((job) =>
    conversationIds.has(job.payload?.conversation_id)
  );
  assert(jobs.length === conversationCount, "Load conversations do not map to one answer job each");
  assert(
    jobs.every((job) => job.status === "completed"),
    "Not all load answer jobs completed"
  );
  assert(
    jobs.every((job) => job.attempts === 1),
    "A load answer job required an unexpected retry"
  );

  const createLatency = latencySummary(verified.map((item) => item.create_latency_ms));
  const acceptanceLatency = latencySummary(verified.map((item) => item.acceptance_latency_ms));
  const answerLatency = latencySummary(verified.map((item) => item.answer_latency_ms));
  assert(
    acceptanceLatency.p95_ms <= acceptP95LimitMs,
    `Acceptance p95 ${acceptanceLatency.p95_ms}ms exceeds ${acceptP95LimitMs}ms`
  );
  assert(
    answerLatency.p95_ms <= answerP95LimitMs,
    `Answer p95 ${answerLatency.p95_ms}ms exceeds ${answerP95LimitMs}ms`
  );

  const report = {
    schema_version: 1,
    kind: "beta_load",
    run_id: runId,
    status: "passed",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    target: {
      conversations: conversationCount,
      concurrency,
      accept_p95_limit_ms: acceptP95LimitMs,
      answer_p95_limit_ms: answerP95LimitMs
    },
    result: {
      conversations: verified.length,
      end_user_messages: verified.length,
      ai_answers: verified.length,
      answer_jobs: jobs.length,
      duplicate_messages: 0,
      unexpected_job_retries: 0
    },
    latency: {
      conversation_create: createLatency,
      message_acceptance: acceptanceLatency,
      answer_completion: answerLatency
    }
  };
  if (reportPath) await writeJsonAtomic(reportPath, report);
  console.log(JSON.stringify(report));
}

function assertIdempotencyPair(results, label) {
  const flags = results.map((result) => result.payload.idempotent).sort();
  assert(
    flags.length === 2 && flags[0] === false && flags[1] === true,
    `${label} did not return one create and one idempotent replay`
  );
}
