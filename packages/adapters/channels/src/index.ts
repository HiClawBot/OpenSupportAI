import type {
  ChannelAdapterDescriptor,
  ChannelAdapterTestResult,
  ChannelProvider,
  NormalizedInboundChannelMessage
} from "@opensupportai/protocol";

export type ChannelWebhookInput = {
  headers: Record<string, string | undefined>;
  payload: unknown;
  receivedAt?: string;
};

export type GenericWebhookAdapterConfig = {
  webhookSecret?: string;
  secretHeader?: string;
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

const stubDescriptors: ChannelAdapterDescriptor[] = [
  {
    provider: "slack",
    name: "Slack",
    status: "stub",
    capabilities: ["receive_message", "send_message", "verify_webhook", "test_connection"],
    configurationKeys: ["bot_token", "signing_secret", "default_channel_id"],
    notes: "Contract placeholder for a future Slack app adapter."
  },
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
  ...stubDescriptors
];

export type StubChannelProvider = "slack" | "email" | "telegram";

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
