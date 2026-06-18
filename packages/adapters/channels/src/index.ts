import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  ChannelAdapterDescriptor,
  ChannelAdapterTestResult,
  ChannelProvider,
  NormalizedInboundChannelMessage
} from "@opensupportai/protocol";

export type ChannelWebhookInput = {
  headers: Record<string, string | undefined>;
  payload: unknown;
  rawBody?: string;
  receivedAt?: string;
};

export type GenericWebhookAdapterConfig = {
  webhookSecret?: string;
  secretHeader?: string;
};

export type SlackAdapterConfig = {
  signingSecret?: string;
  defaultInboxId?: string;
  defaultChannelId?: string;
  clockToleranceSeconds?: number;
};

export interface InboundChannelAdapter {
  provider: ChannelProvider;
  descriptor: ChannelAdapterDescriptor;
  testConnection(): Promise<ChannelAdapterTestResult>;
  normalizeInboundWebhook(input: ChannelWebhookInput): Promise<NormalizedInboundChannelMessage>;
}

const genericWebhookDescriptor: ChannelAdapterDescriptor = {
  provider: "generic_webhook",
  name: "Generic Webhook",
  status: "available",
  capabilities: ["receive_message", "verify_webhook", "test_connection"],
  configurationKeys: ["public_key", "webhook_secret"],
  notes:
    "Accepts normalized or nested JSON payloads and creates OpenSupportAI conversations from inbound text messages."
};

const slackDescriptor: ChannelAdapterDescriptor = {
  provider: "slack",
  name: "Slack",
  status: "available",
  capabilities: ["receive_message", "verify_webhook", "test_connection"],
  configurationKeys: ["signing_secret", "default_channel_id", "default_inbox_id"],
  notes: "Accepts signed Slack Events API message callbacks and normalizes them into conversations."
};

const stubDescriptors: ChannelAdapterDescriptor[] = [
  {
    provider: "email",
    name: "Email",
    status: "stub",
    capabilities: ["receive_message", "send_message", "verify_webhook", "test_connection"],
    configurationKeys: ["inbound_address", "smtp_host", "smtp_username", "smtp_password"],
    notes: "Contract placeholder for inbound mailbox and outbound SMTP support."
  },
  {
    provider: "telegram",
    name: "Telegram",
    status: "stub",
    capabilities: ["receive_message", "send_message", "verify_webhook", "test_connection"],
    configurationKeys: ["bot_token", "webhook_secret"],
    notes: "Contract placeholder for a future Telegram bot adapter."
  }
];

export const channelAdapterCatalog: ChannelAdapterDescriptor[] = [
  genericWebhookDescriptor,
  slackDescriptor,
  ...stubDescriptors
];

export type StubChannelProvider = "email" | "telegram";

export function createGenericWebhookAdapter(
  config: GenericWebhookAdapterConfig = {}
): InboundChannelAdapter {
  return {
    provider: "generic_webhook",
    descriptor: genericWebhookDescriptor,
    async testConnection() {
      return {
        provider: "generic_webhook",
        ok: true,
        status: "ok",
        message: "Generic webhook adapter is available."
      };
    },
    async normalizeInboundWebhook(input) {
      verifyWebhookSecret(input.headers, config);
      const payload = recordValue(input.payload);
      if (!payload) {
        throw new Error("Generic webhook payload must be a JSON object");
      }

      const messageRecord = recordValue(payload["message"]);
      const contactRecord =
        recordValue(payload["contact"]) ??
        recordValue(payload["user"]) ??
        recordValue(payload["customer"]) ??
        {};
      const conversationRecord =
        recordValue(payload["conversation"]) ?? recordValue(payload["thread"]) ?? {};
      const text =
        stringValue(payload["text"]) ??
        stringValue(payload["content"]) ??
        stringValue(payload["body"]) ??
        stringValue(messageRecord?.["text"]) ??
        stringValue(messageRecord?.["content"]) ??
        stringValue(messageRecord?.["body"]);

      if (!text?.trim()) {
        throw new Error("Generic webhook payload must include text content");
      }

      const externalEventId =
        stringValue(payload["event_id"]) ??
        stringValue(payload["eventId"]) ??
        stringValue(payload["id"]) ??
        stringValue(messageRecord?.["id"]) ??
        stringValue(payload["message_id"]);
      const externalConversationId =
        stringValue(payload["external_conversation_id"]) ??
        stringValue(payload["conversation_id"]) ??
        stringValue(conversationRecord["id"]) ??
        stringValue(payload["thread_id"]);
      const localConversationId =
        stringValue(payload["local_conversation_id"]) ??
        stringValue(payload["opensupportai_conversation_id"]);
      const externalUserId =
        stringValue(contactRecord["external_user_id"]) ??
        stringValue(contactRecord["externalUserId"]) ??
        stringValue(contactRecord["id"]) ??
        stringValue(payload["external_user_id"]) ??
        stringValue(payload["user_id"]) ??
        stringValue(payload["sender_id"]) ??
        stringValue(contactRecord["email"]);

      return {
        provider: "generic_webhook",
        externalEventId,
        externalConversationId,
        localConversationId,
        inboxId:
          stringValue(payload["inbox_id"]) ??
          stringValue(payload["inboxId"]) ??
          stringValue(conversationRecord["inbox_id"]),
        contact: {
          externalUserId,
          name: stringValue(contactRecord["name"]) ?? stringValue(payload["name"]),
          email: stringValue(contactRecord["email"]) ?? stringValue(payload["email"])
        },
        message: {
          type: "text",
          text: text.trim()
        },
        metadata: {
          adapter: "generic_webhook",
          event_type: stringValue(payload["event_type"]) ?? stringValue(payload["type"]),
          source: stringValue(payload["source"]),
          ...(recordValue(payload["metadata"]) ?? {})
        },
        receivedAt: input.receivedAt ?? new Date().toISOString()
      };
    }
  };
}

export function createSlackAdapter(config: SlackAdapterConfig = {}): InboundChannelAdapter {
  return {
    provider: "slack",
    descriptor: slackDescriptor,
    async testConnection() {
      if (!config.signingSecret) {
        return {
          provider: "slack",
          ok: false,
          status: "failed",
          message: "Slack signing_secret is not configured."
        };
      }
      return {
        provider: "slack",
        ok: true,
        status: "ok",
        message: "Slack inbound webhook adapter is configured for signed Events API callbacks.",
        metadata: {
          default_channel_id: config.defaultChannelId,
          default_inbox_id: config.defaultInboxId
        }
      };
    },
    async normalizeInboundWebhook(input) {
      verifySlackWebhookSignature(input, config);
      const payload = recordValue(input.payload);
      if (!payload) {
        throw new Error("Slack webhook payload must be a JSON object");
      }

      const event = recordValue(payload["event"]);
      if (!event) {
        throw new Error("Slack webhook payload must include an event object");
      }
      const eventType = stringValue(event["type"]);
      if (eventType !== "message") {
        throw new Error(`Unsupported Slack event type: ${eventType ?? "unknown"}`);
      }
      const subtype = stringValue(event["subtype"]);
      if (subtype && subtype !== "thread_broadcast") {
        throw new Error(`Unsupported Slack message subtype: ${subtype}`);
      }

      const text = stringValue(event["text"]);
      if (!text?.trim()) {
        throw new Error("Slack message event must include text content");
      }

      const teamId = stringValue(payload["team_id"]);
      const channelId =
        stringValue(event["channel"]) ??
        stringValue(payload["channel_id"]) ??
        config.defaultChannelId;
      const eventTs = stringValue(event["ts"]);
      const threadTs = stringValue(event["thread_ts"]) ?? eventTs;
      const externalConversationId =
        teamId && channelId && threadTs
          ? `${teamId}:${channelId}:${threadTs}`
          : [teamId, channelId, threadTs].filter(Boolean).join(":") || undefined;
      const fallbackEventId = [channelId, eventTs].filter(Boolean).join(":") || undefined;

      return {
        provider: "slack",
        externalEventId:
          stringValue(payload["event_id"]) ??
          stringValue(event["client_msg_id"]) ??
          fallbackEventId,
        externalConversationId,
        inboxId: config.defaultInboxId,
        contact: {
          externalUserId: stringValue(event["user"]) ?? stringValue(event["bot_id"])
        },
        message: {
          type: "text",
          text: text.trim()
        },
        metadata: {
          adapter: "slack",
          event_type: stringValue(payload["type"]),
          team_id: teamId,
          channel_id: channelId,
          thread_ts: threadTs,
          event_ts: eventTs
        },
        receivedAt: input.receivedAt ?? new Date().toISOString()
      };
    }
  };
}

export function createStubChannelAdapter(provider: StubChannelProvider): InboundChannelAdapter {
  const descriptor = stubDescriptors.find((item) => item.provider === provider);
  if (!descriptor) {
    throw new Error(`Unsupported stub channel provider: ${provider}`);
  }

  return {
    provider,
    descriptor,
    async testConnection() {
      return {
        provider,
        ok: false,
        status: "stub",
        message: `${descriptor.name} adapter is defined as a contract stub and is not yet connected.`
      };
    },
    async normalizeInboundWebhook() {
      throw new Error(`${descriptor.name} adapter is a contract stub`);
    }
  };
}

export function isSlackUrlVerificationPayload(payload: unknown): payload is { challenge: string } {
  const record = recordValue(payload);
  return record?.["type"] === "url_verification" && typeof record["challenge"] === "string";
}

function verifyWebhookSecret(
  headers: Record<string, string | undefined>,
  config: GenericWebhookAdapterConfig
): void {
  if (!config.webhookSecret) {
    return;
  }

  const configuredHeader = config.secretHeader?.toLowerCase();
  const headerValue =
    (configuredHeader ? headers[configuredHeader] : undefined) ??
    headers["x-opensupportai-webhook-secret"] ??
    headers["x-webhook-secret"];
  const bearerValue = headers.authorization?.startsWith("Bearer ")
    ? headers.authorization.slice("Bearer ".length).trim()
    : undefined;

  if (headerValue === config.webhookSecret || bearerValue === config.webhookSecret) {
    return;
  }

  throw new Error("Invalid generic webhook secret");
}

export function verifySlackWebhookSignature(
  input: ChannelWebhookInput,
  config: SlackAdapterConfig
): void {
  if (!config.signingSecret) {
    throw new Error("Slack signing_secret is not configured");
  }

  const timestamp = input.headers["x-slack-request-timestamp"];
  const signature = input.headers["x-slack-signature"];
  if (!timestamp || !signature) {
    throw new Error("Missing Slack signature headers");
  }

  const timestampSeconds = Number(timestamp);
  const tolerance = config.clockToleranceSeconds ?? 60 * 5;
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > tolerance
  ) {
    throw new Error("Slack signature timestamp is outside the allowed tolerance");
  }

  const rawBody = input.rawBody ?? JSON.stringify(input.payload);
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", config.signingSecret).update(base).digest("hex")}`;
  if (!safeEqual(expected, signature)) {
    throw new Error("Invalid Slack signature");
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}
