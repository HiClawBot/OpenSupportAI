import { afterEach, describe, expect, it, vi } from "vitest";
import { init, OpenSupportAIWidgetClient } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenSupportAI widget", () => {
  it("creates a headless widget controller", () => {
    const controller = init({
      apiUrl: "http://localhost:4000",
      projectId: "proj_demo",
      publicKey: "pk_demo"
    });

    expect(controller.client.options.apiUrl).toBe("http://localhost:4000");
  });

  it("stores the returned capability and excludes the project key from messages", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/client/conversations")) {
        return Response.json({
          conversation_id: "conv_widget",
          status: "open",
          conversation_token: "widget_conversation_secret",
          conversation_token_expires_at: "2026-07-22T00:00:00.000Z"
        });
      }
      return Response.json({
        message_id: "msg_widget",
        conversation_id: "conv_widget",
        status: "accepted"
      });
    });
    const client = new OpenSupportAIWidgetClient({
      apiUrl: "https://support.example.com",
      projectId: "proj_demo",
      publicKey: "pk_demo"
    });

    const conversation = await client.createConversation({ idempotencyKey: "widget-create" });
    await client.sendMessage({
      conversationId: conversation.conversationId,
      text: "Hello",
      idempotencyKey: "widget-message"
    });

    expect(new Headers(calls[0]?.init?.headers).get("x-opensupportai-public-key")).toBe("pk_demo");
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe(
      "Bearer widget_conversation_secret"
    );
    expect(new Headers(calls[1]?.init?.headers).get("x-opensupportai-public-key")).toBeNull();
    expect(new Headers(calls[0]?.init?.headers).get("idempotency-key")).toBe("widget-create");
    expect(new Headers(calls[1]?.init?.headers).get("idempotency-key")).toBe("widget-message");
  });
});
