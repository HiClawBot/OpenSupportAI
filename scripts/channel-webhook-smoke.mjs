#!/usr/bin/env node

import "dotenv/config";

const help = `OpenSupportAI channel webhook smoke test

This script exercises a running OpenSupportAI API with the seeded demo project:
1. checks API health
2. lists channel adapter descriptors
3. tests the generic webhook adapter
4. sends two generic webhook messages on the same external conversation id
5. verifies the messages landed on the same OpenSupportAI conversation
6. verifies processed generic webhook events are visible to admins

Optional environment variables:
  API_URL=http://localhost:4000
  ADMIN_TOKEN=admin_demo_key (or ADMIN_API_TOKEN)
  PROJECT_ID=proj_demo
  PUBLIC_KEY=pk_demo
  INBOX_ID=inbox_default

Example:
  OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev
  pnpm smoke:channels
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

const runId = `channel_smoke_${Date.now()}`;
const externalConversationId = `${runId}_thread`;

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  log("Checking API health");
  const health = await request("GET", "/health");
  assert(health.status === "ok", "API health did not return ok");

  log("Listing channel adapters");
  const adapters = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/channels/adapters`
  );
  assert(
    adapters.adapters?.some((adapter) => adapter.provider === "generic_webhook"),
    "Generic webhook adapter was not listed"
  );

  log("Testing generic webhook adapter");
  const testResult = await adminRequest(
    "POST",
    `/v1/admin/projects/${settings.projectId}/channels/adapters/generic_webhook/test`
  );
  assert(testResult.result?.ok === true, "Generic webhook adapter test did not pass");

  log("Sending first generic webhook message");
  const first = await channelRequest({
    project_id: settings.projectId,
    inbox_id: settings.inboxId,
    event_id: `${runId}_evt_1`,
    conversation_id: externalConversationId,
    text: "怎么取消订阅？",
    contact: {
      id: `${runId}_user`,
      name: "OpenSupportAI Channel Smoke",
      email: `${runId}@example.com`
    }
  });
  assert(first.status === "processed", `Expected processed, got ${first.status}`);
  assert(typeof first.conversation_id === "string", "Webhook did not return a conversation_id");

  log("Sending second generic webhook message on the same external conversation");
  const second = await channelRequest({
    project_id: settings.projectId,
    message: {
      id: `${runId}_evt_2`,
      content: "我还想了解退款"
    },
    conversation: {
      id: externalConversationId
    },
    user: {
      external_user_id: `${runId}_user`
    }
  });
  assert(
    second.conversation_id === first.conversation_id,
    "Second webhook did not reuse the same local conversation"
  );

  log("Reading conversation messages");
  const messages = await clientRequest(
    "GET",
    `/v1/client/conversations/${first.conversation_id}/messages`
  );
  const endUserTexts = messages.messages
    ?.filter((message) => message.role === "end_user")
    .map((message) => message.content?.text);
  assert(endUserTexts?.includes("怎么取消订阅？"), "First webhook message was not stored");
  assert(endUserTexts?.includes("我还想了解退款"), "Second webhook message was not stored");

  log("Checking processed webhook events");
  const events = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/webhooks/events?provider=generic_webhook&status=processed`
  );
  const eventIds = events.webhook_events?.map((event) => event.externalEventId) ?? [];
  assert(eventIds.includes(`${runId}_evt_1`), "First webhook event was not processed");
  assert(eventIds.includes(`${runId}_evt_2`), "Second webhook event was not processed");

  log(`Channel webhook smoke test passed for conversation ${first.conversation_id}`);
}

async function channelRequest(body) {
  return request("POST", `/v1/channel-webhooks/generic?public_key=${settings.publicKey}`, body);
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
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
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
  console.log(`[channel-smoke] ${message}`);
}
