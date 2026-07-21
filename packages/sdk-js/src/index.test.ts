import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenSupportAIClient } from "./index";

type FetchCall = { url: string; init?: RequestInit };

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListener>();
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === "function") {
      this.listeners.set(type, listener);
    }
  }

  close(): void {
    this.closed = true;
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenSupportAIClient", () => {
  it("uses the project key only to create and the capability for later requests", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/client/conversations")) {
        return Response.json({
          conversation_id: "conv_123",
          status: "open",
          conversation_token: "conversation_secret",
          conversation_token_expires_at: "2026-07-22T00:00:00.000Z"
        });
      }
      return Response.json({
        message_id: "msg_123",
        conversation_id: "conv_123",
        status: "accepted"
      });
    });
    const client = new OpenSupportAIClient({
      apiUrl: "https://support.example.com",
      projectId: "proj_demo",
      publicKey: "pk_demo"
    });

    const conversation = await client.createConversation({});
    await client.sendMessage({ conversationId: conversation.conversationId, text: "Hello" });

    expect(new Headers(calls[0]?.init?.headers).get("x-opensupportai-public-key")).toBe("pk_demo");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe(
      "Bearer conversation_secret"
    );
    expect(new Headers(calls[1]?.init?.headers).get("x-opensupportai-public-key")).toBeNull();
  });

  it("exchanges a capability for a short-lived SSE token and handles native errors", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/stream-token")) {
        return Response.json({
          stream_token: "short_stream_secret",
          expires_at: "2026-07-21T12:01:00.000Z"
        });
      }
      return Response.json({ messages: [] });
    });
    vi.stubGlobal("EventSource", FakeEventSource);
    const client = new OpenSupportAIClient({
      apiUrl: "https://support.example.com",
      projectId: "proj_demo",
      publicKey: "pk_demo",
      conversationToken: "long_conversation_secret",
      pollIntervalMs: 60_000
    });

    const unsubscribe = client.subscribe("conv_123", vi.fn());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    const url = new URL(source?.url ?? "");

    expect(url.searchParams.get("stream_token")).toBe("short_stream_secret");
    expect(url.toString()).not.toContain("long_conversation_secret");
    expect(url.searchParams.has("public_key")).toBe(false);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer long_conversation_secret"
    );
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBeNull();
    expect(() => source?.onerror?.(new Event("error"))).not.toThrow();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));

    unsubscribe();
    expect(source?.closed).toBe(true);
  });
});
