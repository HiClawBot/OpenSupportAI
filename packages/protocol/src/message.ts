export type MessageRole = "end_user" | "ai_agent" | "human_agent" | "system" | "tool";

export type MessageVisibility = "public" | "internal_note" | "debug_trace";

export type MessageContentType = "text" | "rich_text" | "file" | "event";

export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  visibility: MessageVisibility;
  contentType: MessageContentType;
  content: Record<string, unknown>;
  sourceRefs?: SourceReference[];
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type SourceReference = {
  documentId: string;
  chunkId?: string;
  title?: string;
  uri?: string;
};

export type SendMessageInput = {
  conversationId: string;
  text: string;
  idempotencyKey?: string;
};

export type SendMessageResponse = {
  messageId: string;
  conversationId: string;
  status: "accepted";
  idempotent?: boolean;
};
