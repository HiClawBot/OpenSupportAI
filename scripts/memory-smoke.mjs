#!/usr/bin/env node

import "dotenv/config";

const help = `OpenSupportAI memory-mode smoke test

This script exercises a running OpenSupportAI API with the seeded demo project:
1. checks API health
2. creates a client conversation
3. sends a grounded support message
4. verifies the AI answer is written locally
5. requests handoff
6. verifies the admin conversation list can find the handoff conversation

Optional environment variables:
  API_URL=http://localhost:4000
  ADMIN_TOKEN=admin_demo_key (or ADMIN_API_TOKEN)
  PROJECT_ID=proj_demo
  PUBLIC_KEY=pk_demo
  INBOX_ID=inbox_default

Example:
  OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev
  pnpm smoke:memory
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
  inboxId: env("INBOX_ID", "inbox_default")
};

const runId = `memory_smoke_${Date.now()}`;

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  log("Checking API health");
  const health = await request("GET", "/health");
  assert(health.status === "ok", "API health did not return ok");

  log("Creating client conversation");
  const conversation = await clientRequest("POST", "/v1/client/conversations", {
    project_id: settings.projectId,
    inbox_id: settings.inboxId,
    contact: {
      external_user_id: runId,
      name: "OpenSupportAI Memory Smoke",
      email: `${runId}@example.com`
    },
    metadata: {
      smoke_test: true,
      run_id: runId
    }
  });
  const conversationId = conversation.conversation_id;
  assert(typeof conversationId === "string", "Create conversation did not return conversation_id");

  log("Sending grounded user message");
  await clientRequest("POST", `/v1/client/conversations/${conversationId}/messages`, {
    type: "text",
    text: "怎么取消订阅？"
  });

  const messages = await clientRequest(
    "GET",
    `/v1/client/conversations/${conversationId}/messages`
  );
  assert(
    messages.messages?.some(
      (message) =>
        message.role === "ai_agent" && String(message.content?.text ?? "").includes("取消订阅")
    ),
    "AI grounded answer was not written locally"
  );

  log("Requesting handoff");
  const handoff = await clientRequest(
    "POST",
    `/v1/client/conversations/${conversationId}/handoff`,
    {
      reason: "user_requested",
      note: `Memory smoke ${runId}`
    }
  );
  assert(
    handoff.status === "handoff_requested",
    `Expected handoff_requested, got ${handoff.status}`
  );

  log("Searching admin conversation list");
  const adminList = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/conversations?q=${encodeURIComponent(runId)}`
  );
  const found = adminList.conversations?.find((item) => item.id === conversationId);
  assert(found, "Admin conversation list did not include the smoke conversation");
  assert(
    found.handoff?.status === "requested",
    "Admin conversation list did not expose handoff status"
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function log(message) {
  console.log(`[memory-smoke] ${message}`);
}
