#!/usr/bin/env node

import "dotenv/config";
import { createServer } from "node:http";

const help = `OpenSupportAI OpenAPI tool executor smoke test

This script exercises a running OpenSupportAI API with the seeded demo project:
1. starts a local HTTP tool fixture
2. configures an active OpenAPI-style tool definition
3. creates a client conversation
4. sends a user message that matches the tool intent
5. verifies the AI answer uses the HTTP tool response
6. verifies the completed tool call is visible to admins

Optional environment variables:
  API_URL=http://localhost:4000
  ADMIN_TOKEN=admin_demo_key (or ADMIN_API_TOKEN)
  PROJECT_ID=proj_demo
  PUBLIC_KEY=pk_demo
  INBOX_ID=inbox_default

Example:
  OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev
  pnpm smoke:tools
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

const runId = `tool_smoke_${Date.now()}`;
const orderId = `EXT-${new Date().getFullYear()}-9001`;
const toolSlug = `openapi.external_order_lookup_${Date.now()}`;

let toolServer;

await main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (toolServer) {
      await new Promise((resolve) => toolServer.close(resolve));
    }
  });

async function main() {
  log("Starting local HTTP tool fixture");
  const fixture = await startToolFixture();
  const toolUrl = new URL(fixture.baseUrl);

  log("Checking API health");
  const health = await request("GET", "/health");
  assert(health.status === "ok", "API health did not return ok");

  log("Configuring OpenAPI tool definition");
  const upsert = await adminRequest("POST", `/v1/admin/projects/${settings.projectId}/tools`, {
    slug: toolSlug,
    name: "External order lookup",
    description: "Looks up orders through a local allowlisted HTTP tool fixture.",
    kind: "openapi",
    status: "active",
    method: "GET",
    path: "/orders/{order_id}",
    input_schema: {
      type: "object",
      required: ["order_id"],
      properties: {
        order_id: { type: "string" }
      }
    },
    output_schema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        status: { type: "string" },
        eta: { type: "string" }
      }
    },
    metadata: {
      base_url: fixture.baseUrl,
      allowed_hosts: [toolUrl.host],
      timeout_ms: 2000,
      max_response_bytes: 2048,
      intent: {
        keywords: ["外部订单"],
        extract: {
          field: "order_id",
          pattern: "EXT-\\d{4}-\\d{4}"
        }
      },
      answer_template: "外部订单 {order_id} 当前状态为 {status}，预计发货 {eta}。"
    }
  });
  assert(upsert.tool?.slug === toolSlug, "OpenAPI tool was not upserted");

  log("Creating client conversation");
  const conversation = await clientRequest("POST", "/v1/client/conversations", {
    project_id: settings.projectId,
    inbox_id: settings.inboxId,
    contact: {
      external_user_id: `${runId}_user`
    }
  });

  log("Sending tool-triggering user message");
  await clientRequest("POST", `/v1/client/conversations/${conversation.conversation_id}/messages`, {
    type: "text",
    text: `请帮我查外部订单 ${orderId}`
  });

  log("Verifying tool-backed answer");
  const messages = await clientRequest(
    "GET",
    `/v1/client/conversations/${conversation.conversation_id}/messages`
  );
  const aiTexts =
    messages.messages
      ?.filter((message) => message.role === "ai_agent")
      .map((message) => message.content?.text) ?? [];
  assert(
    aiTexts.some((text) => text?.includes("当前状态为 shipped")),
    "AI answer did not include the HTTP tool response"
  );

  log("Checking completed tool call");
  const calls = await adminRequest(
    "GET",
    `/v1/admin/projects/${settings.projectId}/tool-calls?conversation_id=${conversation.conversation_id}`
  );
  const completed = calls.tool_calls?.find((call) => call.toolSlug === toolSlug);
  assert(completed?.status === "completed", "OpenAPI tool call was not completed");
  assert(completed?.output?.status === "shipped", "OpenAPI tool call output was not stored");

  log(`OpenAPI tool executor smoke test passed for conversation ${conversation.conversation_id}`);
}

async function startToolFixture() {
  toolServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === `/orders/${orderId}`) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          order_id: orderId,
          status: "shipped",
          eta: "2026-06-25"
        })
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => toolServer.listen(0, "127.0.0.1", resolve));
  const address = toolServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start local HTTP tool fixture");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`
  };
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
  console.log(`[tool-smoke] ${message}`);
}
