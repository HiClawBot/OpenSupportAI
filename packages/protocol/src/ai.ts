import type { SourceReference } from "./message";

export type LlmProviderKind = "openai_compatible";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  sourceRefs?: SourceReference[];
};

export type ChatResponse = {
  text: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type ChatChunk = {
  text: string;
  done: boolean;
};

export type AiRunStatus = "started" | "completed" | "failed" | "skipped" | "handoff";
