#!/usr/bin/env node

import "dotenv/config";

const help = `OpenSupportAI Chatwoot smoke test

This script exercises a live OpenSupportAI API and a configured Chatwoot account:
1. checks the OpenSupportAI API health endpoint
2. saves Chatwoot integration settings
3. runs the Chatwoot connection test endpoint
4. creates a client conversation and requests handoff
5. verifies a Chatwoot external conversation id was stored
6. simulates a Chatwoot agent reply webhook
7. simulates a Chatwoot resolved status webhook

Required environment variables:
  CHATWOOT_BASE_URL
  CHATWOOT_ACCOUNT_ID
  CHATWOOT_INBOX_ID
  CHATWOOT_API_ACCESS_TOKEN
  CHATWOOT_WEBHOOK_SECRET

Optional environment variables:
  API_URL=http://localhost:4000
  ADMIN_TOKEN=admin_demo_key (or ADMIN_API_TOKEN)
  PROJECT_ID=proj_demo
  PUBLIC_KEY=pk_demo
  INBOX_ID=inbox_default

Example:
  API_URL=http://localhost:4000 \\
  ADMIN_TOKEN=admin_demo_key \\
  PROJECT_ID=proj_demo \\
  PUBLIC_KEY=pk_demo \\
  CHATWOOT_BASE_URL=http://localhost:3008 \\
  CHATWOOT_ACCOUNT_ID=1 \\
  CHATWOOT_INBOX_ID=1 \\
  CHATWOOT_API_ACCESS_TOKEN=token \\
  CHATWOOT_WEBHOOK_SECRET=local_secret \\
  pnpm smoke:chatwoot
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

const settings = {
  apiUrl: env("API_URL", "http://localhost:4000"),
  adminToken: env("ADMIN_TOKEN", env("ADMIN_API_TOKEN", "admin_demo_key")),
  projectId: env("PROJECT_ID", "proj_demo"),
  publicKey: env("PUBLIC_KEY", "pk_demo"),
  inboxId: env("INBOX_ID", "inbox_default"),
  chatwootBaseUrl: requiredEnv("CHATWOOT_BASE_URL"),
  chatwootAccountId: requiredEnv("CHATWOOT_ACCOUNT_ID"),
  chatwootInboxId: requiredEnv("CHATWOOT_INBOX_ID"),
  chatwootApiAccessToken: requiredEnv("CHATWOOT_API_ACCESS_TOKEN"),
  chatwootWebhookSecret: requiredEnv("CHATWOOT_WEBHOOK_SECRET")
};

const runId = `smoke_${Date.now()}`;

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  log("Checking API health");
  const health = await request("GET", "/health");
  assert(health.status === "ok", "API health did not return ok");

  log("Saving Chatwoot integration");
  await adminRequest("POST", `/v1/admin/projects/${settings.projectId}/integrations/chatwoot`, {
    base_url: settings.chatwootBaseUrl,
    account_id: settings.chatwootAccountId,
    inbox_id: settings.chatwootInboxId,
    api_access_token: settings.chatwootApiAccessToken,
    webhook_secret: settings.chatwootWebhookSecret,
    status: "active"
  });

  log("Testing Chatwoot connection");
  const testResult = await adminRequest(
    "POST",
    `/v1/admin/projects/${settings.projectId}/integrations/chatwoot/test`,
    {}
  );
  assert(testResult.ok === true, `Chatwoot test failed: ${testResult.error ?? "unknown error"}`);

  log("Creating client conversation");
  const conversation = await clientRequest("POST", "/v1/client/conversations", {
    project_id: settings.projectId,
    inbox_id: settings.inboxId,
    contact: {
      external_user_id: runId,
      name: "OpenSupportAI Smoke Test",
      email: `${runId}@example.com`
    },
    metadata: {
      smoke_test: true,
      run_id: runId
    }
  });
  const conversationId = conversation.conversation_id;
  assert(typeof conversationId === "string", "Create conversation did not return conversation_id");

  log("Requesting handoff");
  const handoff = await clientRequest(
    "POST",
    `/v1/client/conversations/${conversationId}/handoff`,
    {
      reason: "user_requested",
      note: `Smoke test ${runId}`
    }
  );
  assert(handoff.status === "handed_off", `Expected handed_off, got ${handoff.status}`);

  log("Reading handoff diagnostics");
  const details = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/conversations/${conversationId}`
  );
  const handoffSession = details.handoff_sessions?.[0];
  const externalConversationId = handoffSession?.externalConversationId;
  assert(
    typeof externalConversationId === "string",
    "Handoff session did not store externalConversationId"
  );

  log("Simulating Chatwoot agent reply webhook");
  await request(
    "POST",
    `/v1/webhooks/chatwoot/${settings.projectId}`,
    {
      id: `${runId}_message`,
      event: "message_created",
      message_type: "outgoing",
      private: false,
      content: "Smoke test agent reply",
      conversation: {
        id: externalConversationId
      }
    },
    {
      "x-opensupportai-signature": settings.chatwootWebhookSecret
    }
  );

  const afterMessage = await clientRequest(
    "GET",
    `/v1/client/conversations/${conversationId}/messages`
  );
  assert(
    afterMessage.messages?.some(
      (message) =>
        message.role === "human_agent" && message.content?.text === "Smoke test agent reply"
    ),
    "Human agent webhook reply was not written locally"
  );

  log("Simulating Chatwoot resolved status webhook");
  await request(
    "POST",
    `/v1/webhooks/chatwoot/${settings.projectId}`,
    {
      id: `${runId}_status`,
      event: "conversation_status_changed",
      status: "resolved",
      conversation: {
        id: externalConversationId
      }
    },
    {
      "x-opensupportai-signature": settings.chatwootWebhookSecret
    }
  );

  const closedDetails = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/conversations/${conversationId}`
  );
  assert(
    closedDetails.conversation?.status === "closed",
    `Expected closed conversation, got ${closedDetails.conversation?.status}`
  );

  log(`Smoke test passed for conversation ${conversationId}`);
}

async function adminRequest(method, path, body) {
  return request(method, path, body, {
    Authorization: `Bearer ${settings.adminToken}`
  });
}

async function clientRequest(method, path, body) {
  return request(method, path, body, {
    "x-opensupportai-public-key": settings.publicKey
  });
}

async function request(method, path, body, headers = {}) {
  const response = await fetch(`${settings.apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  }
  return payload;
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}\n\n${help}`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function log(message) {
  console.log(`[chatwoot-smoke] ${message}`);
}
