#!/usr/bin/env node

import {
  adminHeaders,
  assert,
  integerEnvironment,
  projectHeaders,
  readJson,
  requestJson,
  runWithConcurrency,
  runtimeSettings,
  uniqueRunId,
  waitFor,
  writeJsonAtomic
} from "./lib/beta-runtime.mjs";

const help = `OpenSupportAI worker outage recovery probe

Usage:
  WORKER_RECOVERY_STATE_PATH=/tmp/state.json node scripts/beta-worker-recovery.mjs enqueue
  WORKER_RECOVERY_STATE_PATH=/tmp/state.json node scripts/beta-worker-recovery.mjs verify

The enqueue phase expects API liveness with readiness HTTP 503, accepts messages
while the worker is unavailable, and records queued job state. The verify phase
expects readiness HTTP 200 after worker restart and proves one durable answer per job.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

const phase = process.argv[2];
if (phase !== "enqueue" && phase !== "verify") {
  throw new Error("Phase must be enqueue or verify");
}

const settings = runtimeSettings();
const statePath = process.env["WORKER_RECOVERY_STATE_PATH"];
assert(statePath, "WORKER_RECOVERY_STATE_PATH is required");
const messageCount = integerEnvironment(process.env, "WORKER_RECOVERY_MESSAGES", 4);
const timeoutMs = integerEnvironment(process.env, "WORKER_RECOVERY_TIMEOUT_MS", 60_000);

if (phase === "enqueue") {
  await enqueue();
} else {
  await verify();
}

async function enqueue() {
  const live = await requestJson(settings, "GET", "/health/live");
  assert(live.payload.status === "ok", "API was not live during worker outage");
  const ready = await requestJson(settings, "GET", "/health/ready", {
    expectedStatuses: [503]
  });
  assert(
    JSON.stringify(ready.payload).includes("worker_stale"),
    "Readiness did not report worker_stale during outage"
  );

  const runId = process.env["WORKER_RECOVERY_RUN_ID"] ?? uniqueRunId("worker_recovery");
  const items = await runWithConcurrency(
    Array.from({ length: messageCount }, (_, index) => index),
    Math.min(4, messageCount),
    async (index) => {
      const conversation = await requestJson(settings, "POST", "/v1/client/conversations", {
        headers: projectHeaders(settings, {
          "Idempotency-Key": `${runId}:conversation:${index}`
        }),
        body: {
          project_id: settings.projectId,
          inbox_id: settings.inboxId,
          contact: {
            external_user_id: `${runId}-${index}`,
            name: `Worker recovery ${runId}`
          },
          metadata: { operational_probe: "worker_recovery", run_id: runId, index }
        }
      });
      const conversationId = conversation.payload.conversation_id;
      const token = conversation.payload.conversation_token;
      const accepted = await requestJson(
        settings,
        "POST",
        `/v1/client/conversations/${conversationId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Idempotency-Key": `${runId}:message:${index}`
          },
          body: { type: "text", text: "怎么取消订阅？" }
        }
      );
      assert(accepted.payload.status === "accepted", `Message ${index} was not accepted`);
      return {
        conversation_id: conversationId,
        message_id: accepted.payload.message_id
      };
    }
  );

  const jobsResponse = await requestJson(
    settings,
    "GET",
    `/v1/admin/projects/${settings.projectId}/jobs?type=answer.generate&limit=100`,
    { headers: adminHeaders(settings) }
  );
  const conversationIds = new Set(items.map((item) => item.conversation_id));
  const jobs = (jobsResponse.payload.jobs ?? []).filter((job) =>
    conversationIds.has(job.payload?.conversation_id)
  );
  assert(jobs.length === messageCount, "Outage messages do not map to one queued job each");
  assert(
    jobs.every((job) => job.status === "queued"),
    "A worker-outage job was not queued"
  );

  const state = {
    schema_version: 1,
    kind: "beta_worker_recovery",
    run_id: runId,
    enqueued_at: new Date().toISOString(),
    items,
    queued_job_ids: jobs.map((job) => job.id)
  };
  await writeJsonAtomic(statePath, state);
  console.log(JSON.stringify({ status: "enqueued", ...state }));
}

async function verify() {
  const state = await readJson(statePath);
  assert(state.schema_version === 1, "Worker recovery state schema is unsupported");
  const ready = await requestJson(settings, "GET", "/health/ready");
  assert(ready.payload.status === "ready", "Runtime did not recover readiness");

  const details = await waitFor(
    async () => {
      const current = await runWithConcurrency(state.items, 4, async (item) => {
        const response = await requestJson(
          settings,
          "GET",
          `/v1/admin/projects/${settings.projectId}/conversations/${item.conversation_id}`,
          { headers: adminHeaders(settings) }
        );
        return response.payload;
      });
      return detailsAreComplete(current, state.items.length) ? current : undefined;
    },
    { timeoutMs, intervalMs: 500, description: "worker recovery answers" }
  );

  for (const detail of details) {
    assert(
      detail.messages.filter((message) => message.role === "end_user").length === 1,
      `${detail.conversation.id} has duplicate end-user messages`
    );
    assert(
      detail.messages.filter((message) => message.role === "ai_agent").length === 1,
      `${detail.conversation.id} has missing or duplicate answers`
    );
  }

  const jobsResponse = await requestJson(
    settings,
    "GET",
    `/v1/admin/projects/${settings.projectId}/jobs?type=answer.generate&limit=100`,
    { headers: adminHeaders(settings) }
  );
  const expectedIds = new Set(state.queued_job_ids);
  const jobs = (jobsResponse.payload.jobs ?? []).filter((job) => expectedIds.has(job.id));
  assert(jobs.length === state.items.length, "Recovered job evidence is incomplete");
  assert(
    jobs.every((job) => job.status === "completed"),
    "A queued outage job did not complete"
  );
  assert(
    jobs.every((job) => job.attempts === 1),
    "A queued outage job executed more than once"
  );

  const report = {
    ...state,
    status: "passed",
    recovered_at: new Date().toISOString(),
    result: {
      accepted_during_outage: state.items.length,
      completed_after_restart: details.length,
      duplicate_messages: 0,
      unexpected_job_retries: 0
    }
  };
  await writeJsonAtomic(statePath, report);
  console.log(JSON.stringify(report));
}

function detailsAreComplete(details, expectedCount) {
  return (
    details.length === expectedCount &&
    details.every((detail) => detail.messages?.some((message) => message.role === "ai_agent"))
  );
}
