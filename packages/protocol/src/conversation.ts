export type ConversationStatus =
  | "open"
  | "pending_ai"
  | "handoff_requested"
  | "handed_off"
  | "closed";

export type Conversation = {
  id: string;
  projectId: string;
  inboxId: string;
  contactId: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateConversationInput = {
  projectId: string;
  inboxId: string;
  contact: {
    externalUserId?: string;
    name?: string;
    email?: string;
  };
  metadata?: Record<string, unknown>;
};

export type CreateConversationResponse = {
  conversationId: string;
  status: ConversationStatus;
};
