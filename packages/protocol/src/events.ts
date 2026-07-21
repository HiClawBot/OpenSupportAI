import type { Message } from "./message";
import type { ConversationStatus } from "./conversation";

export type ClientEventName =
  | "message.created"
  | "ai.delta"
  | "ai.message.completed"
  | "handoff.requested"
  | "human.message.created"
  | "conversation.status_changed"
  | "support.error";

export type ClientEvent =
  | {
      event: "message.created" | "ai.message.completed" | "human.message.created";
      data: { message: Message };
    }
  | {
      event: "ai.delta";
      data: { conversationId: string; text: string };
    }
  | {
      event: "handoff.requested";
      data: { conversationId: string; reason: string };
    }
  | {
      event: "conversation.status_changed";
      data: { conversationId: string; status: ConversationStatus };
    }
  | {
      event: "support.error";
      data: { code: string; message: string };
    };
