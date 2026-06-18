#!/usr/bin/env node

import "dotenv/config";
import { createHmac } from "node:crypto";

const help = `OpenSupportAI channel webhook smoke test

This script exercises a running OpenSupportAI API with the seeded demo project:
1. checks API health
2. lists channel adapter descriptors
3. tests the generic webhook adapter
4. configures a generic webhook secret
5. verifies unauthorized public keys, invalid secrets, and invalid payloads fail
6. sends two generic webhook messages on the same external conversation id
7. verifies duplicate event ids are idempotent
8. verifies processed and failed generic webhook events are visible to admins
9. configures Slack inbound webhooks and verifies signed URL verification callbacks
10. sends a signed Slack message event and verifies idempotency/admin visibility

Optional environment variables:
  API_URL=http://localhost:4000
  ADMIN_TOKEN=admin_demo_key (or ADMIN_API_TOKEN)
  PROJECT_ID=proj_demo
  PUBLIC_KEY=pk_demo
  INBOX_ID=inbox_default
  GENERIC_WEBHOOK_SECRET=local_channel_secret
  GENERIC_WEBHOOK_SECRET_HEADER=x-opensupportai-webhook-secret
  SLACK_SIGNING_SECRET=local_slack_secret
  SLACK_DEFAULT_CHANNEL_ID=CLOCAL

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
  inboxId: env("INBOX_ID", "inbox_default"),
  webhookSecret: env("GENERIC_WEBHOOK_SECRET", "local_channel_secret"),
  webhookSecretHeader: env("GENERIC_WEBHOOK_SECRET_HEADER", "x-opensupportai-webhook-secret"),
  slackSigningSecret: env("SLACK_SIGNING_SECRET", "local_slack_secret"),
  slackDefaultChannelId: env("SLACK_DEFAULT_CHANNEL_ID", "CLOCAL")
};

const runId = `channel_smoke_${Date.now()}`;
const externalConversationId = `${runId}_thread`;
const slackEventTs = `${Math.floor(Date.now() / 1000)}.000100`;
const slackConversationId = `TLOCAL:${settings.slackDefaultChannelId}:${slackEventTs}`;

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
  assert(
    adapters.adapters?.some(
      (adapter) => adapter.provider === "slack" && adapter.status === "available"
    ),
    "Slack adapter was not listed as available"
  );

  log("Testing generic webhook adapter");
  const testResult = await adminRequest(
    "POST",
    `/v1/admin/projects/${settings.projectId}/channels/adapters/generic_webhook/test`
  );
  assert(testResult.result?.ok === true, "Generic webhook adapter test did not pass");

  log("Configuring generic webhook secret");
  const channelConfig = await adminRequest(
    "POST",
    `/v1/admin/projects/${settings.projectId}/channels/generic-webhook`,
    {
      webhook_secret: settings.webhookSecret,
      secret_header: settings.webhookSecretHeader,
      status: "active"
    }
  );
  assert(
    channelConfig.channel?.metadata?.secret_configured === true,
    "Generic webhook secret was not marked configured"
  );

  log("Checking negative generic webhook cases");
  await expectStatus(
    "POST",
    `/v1/channel-webhooks/generic?public_key=pk_invalid`,
    {
      project_id: settings.projectId,
      event_id: `${runId}_unauthorized`,
      text: "Should not be accepted"
    },
    { [settings.webhookSecretHeader]: settings.webhookSecret },
    401
  );
  await expectStatus(
    "POST",
    `/v1/channel-webhooks/generic?public_key=${settings.publicKey}`,
    {
      project_id: settings.projectId,
      event_id: `${runId}_bad_secret`,
      text: "Should not be accepted"
    },
    { [settings.webhookSecretHeader]: "wrong" },
    401
  );
  await expectStatus(
    "POST",
    `/v1/channel-webhooks/generic?public_key=${settings.publicKey}`,
    {
      project_id: settings.projectId,
      event_id: `${runId}_bad_payload`
    },
    { [settings.webhookSecretHeader]: settings.webhookSecret },
    400
  );

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

  log("Re-sending first generic webhook event to verify idempotency");
  const duplicate = await channelRequest({
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
  assert(duplicate.idempotent === true, "Duplicate webhook event was not idempotent");

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
  assert(
    endUserTexts?.filter((text) => text === "怎么取消订阅？").length === 1,
    "Duplicate webhook event wrote a second end-user message"
  );
  assert(endUserTexts?.includes("我还想了解退款"), "Second webhook message was not stored");

  log("Checking admin channel visibility");
  const adminList = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/conversations?q=${encodeURIComponent(externalConversationId)}`
  );
  const conversation = adminList.conversations?.find((item) => item.id === first.conversation_id);
  assert(conversation?.channel?.provider === "generic_webhook", "Admin list missed channel data");
  assert(
    conversation?.channel?.externalConversationId === externalConversationId,
    "Admin list missed external conversation id"
  );

  log("Checking processed webhook events");
  const events = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/webhooks/events?provider=generic_webhook&status=processed`
  );
  const eventIds = events.webhook_events?.map((event) => event.externalEventId) ?? [];
  assert(eventIds.includes(`${runId}_evt_1`), "First webhook event was not processed");
  assert(eventIds.includes(`${runId}_evt_2`), "Second webhook event was not processed");

  const failedEvents = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/webhooks/events?provider=generic_webhook&status=failed`
  );
  const failedEventIds = failedEvents.webhook_events?.map((event) => event.externalEventId) ?? [];
  assert(failedEventIds.includes(`${runId}_bad_secret`), "Bad secret event was not recorded");
  assert(failedEventIds.includes(`${runId}_bad_payload`), "Bad payload event was not recorded");

  log("Configuring Slack inbound channel");
  const slackConfig = await adminRequest(
    "POST",
    `/v1/admin/projects/${settings.projectId}/channels/slack`,
    {
      signing_secret: settings.slackSigningSecret,
      default_channel_id: settings.slackDefaultChannelId,
      default_inbox_id: settings.inboxId,
      status: "active"
    }
  );
  assert(
    slackConfig.channel?.metadata?.signing_secret_configured === true,
    "Slack signing secret was not marked configured"
  );

  log("Testing Slack adapter");
  const slackTest = await adminRequest(
    "POST",
    `/v1/admin/projects/${settings.projectId}/channels/adapters/slack/test`
  );
  assert(slackTest.result?.ok === true, "Slack adapter test did not pass");

  log("Verifying Slack URL challenge");
  const challengePayload = {
    type: "url_verification",
    challenge: `${runId}_challenge`
  };
  const challengeResult = await slackRequest(challengePayload);
  assert(
    challengeResult.challenge === challengePayload.challenge,
    "Slack challenge was not echoed"
  );

  log("Checking invalid Slack signature handling");
  const badSlackPayload = {
    type: "event_callback",
    team_id: "TLOCAL",
    event_id: `${runId}_slack_bad_signature`,
    event: {
      type: "message",
      channel: settings.slackDefaultChannelId,
      user: `${runId}_slack_user`,
      text: "Should not be accepted",
      ts: `${Math.floor(Date.now() / 1000)}.000000`
    }
  };
  await expectStatus(
    "POST",
    `/v1/channel-webhooks/slack?public_key=${settings.publicKey}`,
    badSlackPayload,
    {
      ...slackHeaders(badSlackPayload),
      "x-slack-signature": "v0=bad"
    },
    401
  );

  log("Sending signed Slack message event");
  const slackPayload = {
    type: "event_callback",
    team_id: "TLOCAL",
    event_id: `${runId}_slack_evt_1`,
    event: {
      type: "message",
      channel: settings.slackDefaultChannelId,
      user: `${runId}_slack_user`,
      text: "怎么取消订阅？",
      ts: slackEventTs,
      thread_ts: slackEventTs
    }
  };
  const firstSlack = await slackRequest(slackPayload);
  assert(firstSlack.status === "processed", `Expected Slack processed, got ${firstSlack.status}`);
  assert(firstSlack.provider === "slack", "Slack webhook response did not identify provider");
  assert(typeof firstSlack.conversation_id === "string", "Slack did not return a conversation_id");

  log("Re-sending Slack event to verify idempotency");
  const duplicateSlack = await slackRequest(slackPayload);
  assert(duplicateSlack.idempotent === true, "Duplicate Slack event was not idempotent");

  log("Checking Slack admin channel visibility");
  const slackAdminList = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/conversations?q=${encodeURIComponent(slackConversationId)}`
  );
  const slackConversation = slackAdminList.conversations?.find(
    (item) => item.id === firstSlack.conversation_id
  );
  assert(slackConversation?.channel?.provider === "slack", "Admin list missed Slack channel data");
  assert(
    slackConversation?.channel?.externalConversationId === slackConversationId,
    "Admin list missed Slack external conversation id"
  );

  log("Checking Slack webhook events");
  const slackEvents = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/webhooks/events?provider=slack&status=processed`
  );
  const slackEventIds = slackEvents.webhook_events?.map((event) => event.externalEventId) ?? [];
  assert(slackEventIds.includes(`${runId}_slack_evt_1`), "Slack event was not processed");

  const failedSlackEvents = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/webhooks/events?provider=slack&status=failed`
  );
  const failedSlackEventIds =
    failedSlackEvents.webhook_events?.map((event) => event.externalEventId) ?? [];
  assert(
    failedSlackEventIds.includes(`${runId}_slack_bad_signature`),
    "Bad Slack signature event was not recorded"
  );

  log(`Channel webhook smoke test passed for conversation ${first.conversation_id}`);
}

async function channelRequest(body) {
  return request("POST", `/v1/channel-webhooks/generic?public_key=${settings.publicKey}`, body, {
    [settings.webhookSecretHeader]: settings.webhookSecret
  });
}

async function slackRequest(body) {
  return request(
    "POST",
    `/v1/channel-webhooks/slack?public_key=${settings.publicKey}`,
    body,
    slackHeaders(body)
  );
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

async function expectStatus(method, path, body, headers, expectedStatus) {
  const response = await fetch(`${settings.apiUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`
    );
  }
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function slackHeaders(body) {
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${createHmac("sha256", settings.slackSigningSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function log(message) {
  console.log(`[channel-smoke] ${message}`);
}
