#!/usr/bin/env node

import {
  adminHeaders,
  assert,
  conversationHeaders,
  integerEnvironment,
  projectHeaders,
  requestJson,
  runtimeSettings,
  uniqueRunId,
  waitFor,
  writeJsonAtomic
} from "./lib/beta-runtime.mjs";

const help = `OpenSupportAI provider fault smoke

Configures disposable failing LLM/tool providers through admin APIs, sends real
messages through the Prisma/worker path, and verifies bounded fallback evidence.
Run only against a disposable seeded project because it changes active provider config.

Environment:
  API_URL=http://127.0.0.1:4000
  ADMIN_TOKEN=required (or ADMIN_API_TOKEN)
  FAULT_TIMEOUT_MS=30000
  FAULT_REPORT_PATH=optional JSON output path
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

const settings = runtimeSettings();
const timeoutMs = integerEnvironment(process.env, "FAULT_TIMEOUT_MS", 30_000);
const runId = process.env["FAULT_RUN_ID"] ?? uniqueRunId("beta_fault");
const reportPath = process.env["FAULT_REPORT_PATH"];
const startedAt = new Date();

await main().catch(async (error) => {
  const report = {
    schema_version: 1,
    kind: "beta_faults",
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

  await requestJson(settings, "POST", `/v1/admin/projects/${settings.projectId}/llm`, {
    headers: adminHeaders(settings),
    body: {
      provider: "openai_compatible",
      base_url: "https://llm.invalid/v1",
      model: "beta-fault-provider",
      api_key: "beta-fault-secret",
      status: "active"
    }
  });
  const llmConversation = await sendProbeMessage("llm", "怎么取消订阅？");
  const llmDetail = await waitForConversationDetail(llmConversation.conversation_id, (detail) =>
    detail.ai_runs?.some((run) => run.metadata?.llm_fallback === true)
  );
  const llmAnswer = llmDetail.messages.find((message) => message.role === "ai_agent");
  const llmRun = llmDetail.ai_runs.find((run) => run.metadata?.llm_fallback === true);
  assert(llmAnswer?.metadata?.grounded === true, "LLM outage did not produce grounded fallback");
  assert(llmAnswer?.sourceRefs?.length > 0, "LLM outage fallback lost source citations");
  assert(llmRun?.status === "completed", "LLM outage fallback did not complete its AI run");
  assert(typeof llmRun?.metadata?.llm_error === "string", "LLM outage error evidence is missing");

  const toolSlug = `beta.shipment_lookup.${runId}`;
  await requestJson(settings, "POST", `/v1/admin/projects/${settings.projectId}/tools`, {
    headers: adminHeaders(settings),
    body: {
      slug: toolSlug,
      name: "Beta failing shipment lookup",
      description: "Disposable provider-fault probe.",
      kind: "openapi",
      status: "active",
      method: "GET",
      path: "/shipments/{tracking_id}",
      input_schema: { type: "object", required: ["tracking_id"] },
      output_schema: { type: "object" },
      metadata: {
        base_url: "https://tool.invalid",
        allowed_hosts: ["tool.invalid"],
        timeout_ms: 1000,
        intent: {
          keywords: [runId],
          extract: { field: "tracking_id", pattern: "(SHIP-[0-9]+)" }
        }
      }
    }
  });
  const toolConversation = await sendProbeMessage("tool", `${runId} 查询物流状态 SHIP-2026`);
  const toolDetail = await waitForConversationDetail(
    toolConversation.conversation_id,
    (detail) =>
      detail.tool_calls?.length > 0 && detail.messages?.some((item) => item.role === "ai_agent")
  );
  const toolAnswer = toolDetail.messages.find((message) => message.role === "ai_agent");
  const toolCall = toolDetail.tool_calls.find((call) => call.toolSlug === toolSlug);
  assert(toolCall?.status === "failed", "Tool outage did not persist a failed tool call");
  assert(typeof toolCall?.error === "string", "Tool outage error evidence is missing");
  assert(
    toolAnswer?.metadata?.tool_failed === true,
    "Tool outage did not return bounded failure UX"
  );

  const report = {
    schema_version: 1,
    kind: "beta_faults",
    run_id: runId,
    status: "passed",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    results: {
      llm_outage: {
        conversation_id: llmConversation.conversation_id,
        fallback: true,
        grounded: true,
        citations_preserved: true,
        ai_run_status: llmRun.status
      },
      tool_outage: {
        conversation_id: toolConversation.conversation_id,
        bounded_answer: true,
        tool_call_status: toolCall.status
      }
    }
  };
  if (reportPath) await writeJsonAtomic(reportPath, report);
  console.log(JSON.stringify(report));
}

async function sendProbeMessage(kind, text) {
  const conversation = await requestJson(settings, "POST", "/v1/client/conversations", {
    headers: projectHeaders(settings, { "Idempotency-Key": `${runId}:${kind}:conversation` }),
    body: {
      project_id: settings.projectId,
      inbox_id: settings.inboxId,
      contact: {
        external_user_id: `${runId}-${kind}`,
        name: `Beta fault ${runId}`
      },
      metadata: { operational_probe: "fault", fault: kind, run_id: runId }
    }
  });
  const conversationId = conversation.payload.conversation_id;
  const token = conversation.payload.conversation_token;
  await requestJson(settings, "POST", `/v1/client/conversations/${conversationId}/messages`, {
    headers: conversationHeaders(token, { "Idempotency-Key": `${runId}:${kind}:message` }),
    body: { type: "text", text }
  });
  return { conversation_id: conversationId };
}

async function waitForConversationDetail(conversationId, predicate) {
  return waitFor(
    async () => {
      const response = await requestJson(
        settings,
        "GET",
        `/v1/admin/projects/${settings.projectId}/conversations/${conversationId}`,
        { headers: adminHeaders(settings) }
      );
      return predicate(response.payload) ? response.payload : undefined;
    },
    { timeoutMs, intervalMs: 500, description: `fault evidence for ${conversationId}` }
  );
}
