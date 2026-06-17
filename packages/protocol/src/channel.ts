export type ChannelProvider = "generic_webhook" | "slack" | "email" | "telegram" | "chatwoot";

export type ChannelAdapterStatus = "available" | "stub";

export type ChannelAdapterCapability =
  | "receive_message"
  | "send_message"
  | "verify_webhook"
  | "test_connection";

export type ChannelAdapterDescriptor = {
  provider: ChannelProvider;
  name: string;
  status: ChannelAdapterStatus;
  capabilities: ChannelAdapterCapability[];
  configurationKeys: string[];
  notes?: string;
};

export type ChannelContact = {
  externalUserId?: string;
  name?: string;
  email?: string;
};

export type NormalizedInboundChannelMessage = {
  provider: ChannelProvider;
  externalEventId?: string;
  externalConversationId?: string;
  localConversationId?: string;
  inboxId?: string;
  contact: ChannelContact;
  message: {
    type: "text";
    text: string;
  };
  metadata: Record<string, unknown>;
  receivedAt: string;
};

export type ChannelAdapterTestResult = {
  provider: ChannelProvider;
  ok: boolean;
  status: "ok" | "stub" | "failed";
  message: string;
  metadata?: Record<string, unknown>;
};

export type ChannelWebhookProcessResponse = {
  status: "processed" | "ignored";
  provider: ChannelProvider;
  webhookEventId: string;
  conversationId?: string;
  messageId?: string;
};
