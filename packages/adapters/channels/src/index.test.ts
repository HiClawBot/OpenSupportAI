import { describe, expect, it } from "vitest";
import {
  channelAdapterCatalog,
  createGenericWebhookAdapter,
  createStubChannelAdapter
} from "./index";

describe("channel adapters", () => {
  it("lists available and stub channel adapters", () => {
    expect(channelAdapterCatalog.map((adapter) => adapter.provider)).toEqual([
      "generic_webhook",
      "slack",
      "email",
      "telegram"
    ]);
  });

  it("normalizes flat generic webhook payloads", async () => {
    const adapter = createGenericWebhookAdapter();

    await expect(
      adapter.normalizeInboundWebhook({
        headers: {},
        payload: {
          event_id: "evt_1",
          conversation_id: "thread_1",
          inbox_id: "inbox_default",
          text: "Need help with billing",
          contact: {
            id: "user_1",
            name: "Ada",
            email: "ada@example.com"
          },
          metadata: {
            source_url: "https://example.com/billing"
          }
        },
        receivedAt: "2026-06-18T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      provider: "generic_webhook",
      externalEventId: "evt_1",
      externalConversationId: "thread_1",
      inboxId: "inbox_default",
      contact: {
        externalUserId: "user_1",
        name: "Ada",
        email: "ada@example.com"
      },
      message: {
        type: "text",
        text: "Need help with billing"
      },
      metadata: {
        source_url: "https://example.com/billing"
      }
    });
  });

  it("normalizes nested generic webhook payloads", async () => {
    const adapter = createGenericWebhookAdapter();
    const normalized = await adapter.normalizeInboundWebhook({
      headers: {},
      payload: {
        message: {
          id: "msg_1",
          content: "Where is my order?"
        },
        user: {
          external_user_id: "customer_1"
        },
        conversation: {
          id: "conv_external_1"
        }
      }
    });

    expect(normalized.externalEventId).toBe("msg_1");
    expect(normalized.externalConversationId).toBe("conv_external_1");
    expect(normalized.contact.externalUserId).toBe("customer_1");
    expect(normalized.message.text).toBe("Where is my order?");
  });

  it("rejects generic webhook payloads without text", async () => {
    const adapter = createGenericWebhookAdapter();
    await expect(
      adapter.normalizeInboundWebhook({
        headers: {},
        payload: {
          event_id: "evt_1"
        }
      })
    ).rejects.toThrow("text content");
  });

  it("verifies optional generic webhook secrets", async () => {
    const adapter = createGenericWebhookAdapter({ webhookSecret: "secret" });
    await expect(
      adapter.normalizeInboundWebhook({
        headers: {
          "x-opensupportai-webhook-secret": "secret"
        },
        payload: {
          text: "Hello"
        }
      })
    ).resolves.toMatchObject({
      message: {
        text: "Hello"
      }
    });
    await expect(
      adapter.normalizeInboundWebhook({
        headers: {
          "x-opensupportai-webhook-secret": "wrong"
        },
        payload: {
          text: "Hello"
        }
      })
    ).rejects.toThrow("Invalid generic webhook secret");
  });

  it("returns stub test results for future providers", async () => {
    const adapter = createStubChannelAdapter("slack");
    await expect(adapter.testConnection()).resolves.toMatchObject({
      provider: "slack",
      ok: false,
      status: "stub"
    });
  });
});
