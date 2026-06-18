import { describe, expect, it } from "vitest";
import {
  channelAdapterCatalog,
  createGenericWebhookAdapter,
  createSlackAdapter,
  createStubChannelAdapter
} from "./index";
import { createHmac } from "node:crypto";

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
    const adapter = createStubChannelAdapter("email");
    await expect(adapter.testConnection()).resolves.toMatchObject({
      provider: "email",
      ok: false,
      status: "stub"
    });
  });

  it("normalizes signed Slack message callbacks", async () => {
    const adapter = createSlackAdapter({
      signingSecret: "slack_secret",
      defaultInboxId: "inbox_default"
    });
    const payload = {
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev123",
      event: {
        type: "message",
        channel: "C123",
        user: "U123",
        text: "Need billing help",
        ts: "1710000000.000100",
        thread_ts: "1710000000.000100"
      }
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = slackSignature("slack_secret", timestamp, rawBody);

    await expect(
      adapter.normalizeInboundWebhook({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature
        },
        payload,
        rawBody,
        receivedAt: "2026-06-18T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      provider: "slack",
      externalEventId: "Ev123",
      externalConversationId: "T123:C123:1710000000.000100",
      inboxId: "inbox_default",
      contact: {
        externalUserId: "U123"
      },
      message: {
        text: "Need billing help"
      },
      metadata: {
        adapter: "slack",
        team_id: "T123",
        channel_id: "C123"
      }
    });
  });

  it("rejects Slack callbacks with invalid signatures", async () => {
    const adapter = createSlackAdapter({ signingSecret: "slack_secret" });
    await expect(
      adapter.normalizeInboundWebhook({
        headers: {
          "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
          "x-slack-signature": "v0=bad"
        },
        payload: {
          type: "event_callback",
          event: {
            type: "message",
            text: "Hello"
          }
        }
      })
    ).rejects.toThrow("Invalid Slack signature");
  });
});

function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}
