export type HandoffReason = "user_requested" | "low_confidence" | "sensitive" | "policy";

export type HandoffProvider = "chatwoot" | "tiledesk" | "zammad";

export type RequestHandoffInput = {
  conversationId: string;
  reason: HandoffReason;
  note?: string;
};

export type RequestHandoffResponse = {
  conversationId: string;
  status: "handoff_requested";
};

export type ExternalConversationRef = {
  provider: HandoffProvider;
  externalConversationId: string;
};
