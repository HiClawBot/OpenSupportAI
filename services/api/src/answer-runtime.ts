import { OpenAICompatibleClient } from "@opensupportai/llm";
import type { PrismaClient } from "@prisma/client";
import { decryptJson } from "./crypto";
import { EventHub } from "./event-hub";
import {
  answerMessageIdempotencyKey,
  createOrchestrator,
  type GroundedAnswerGenerator
} from "./orchestrator";
import { createSafeOutboundFetch } from "./outbound";
import { PrismaSupportRepository } from "./repositories/prisma";
import type {
  JsonRecord,
  KnowledgeChunkRecord,
  LlmProviderRecord,
  SupportRepository
} from "./repositories/types";

export const ANSWER_GENERATE_JOB_TYPE = "answer.generate";

export type AnswerRuntimeConfig = {
  encryptionKey: string;
  allowPrivateOutbound: boolean;
  llmTimeoutMs: number;
  maxConcurrentAnswersPerProject: number;
};

export type AnswerJobResult = {
  project_id: string;
  conversation_id: string;
  source_message_id: string;
  answer_message_id?: string;
  status: "completed" | "handoff";
};

export type AnswerJobProcessor = (payload: Record<string, unknown>) => Promise<AnswerJobResult>;

export function loadAnswerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AnswerRuntimeConfig {
  const encryptionKey = env["ENCRYPTION_KEY"] ?? "replace_with_32_byte_key";
  if (
    env["NODE_ENV"] === "production" &&
    (encryptionKey === "replace_with_32_byte_key" || encryptionKey === "replace_me")
  ) {
    throw new Error("Production answer workers require a non-default ENCRYPTION_KEY");
  }
  return {
    encryptionKey,
    allowPrivateOutbound: parseBoolean(
      env["ALLOW_PRIVATE_OUTBOUND"],
      env["NODE_ENV"] !== "production"
    ),
    llmTimeoutMs: positiveInteger(env["LLM_TIMEOUT_MS"], 45_000),
    maxConcurrentAnswersPerProject: positiveInteger(env["MAX_CONCURRENT_ANSWERS_PER_PROJECT"], 4)
  };
}

export function createAnswerJobProcessor(input: {
  repository: SupportRepository;
  config: AnswerRuntimeConfig;
  llmFetch?: typeof fetch;
  toolFetch?: typeof fetch;
  eventHub?: EventHub;
}): AnswerJobProcessor {
  const eventHub = input.eventHub ?? new EventHub();
  const llmFetch = createSafeOutboundFetch({
    allowPrivateNetwork: input.config.allowPrivateOutbound,
    fetchImpl: input.llmFetch
  });
  const toolFetch = createSafeOutboundFetch({
    allowPrivateNetwork: input.config.allowPrivateOutbound,
    fetchImpl: input.toolFetch
  });
  const orchestrator = createOrchestrator(input.repository, eventHub, {
    generateGroundedAnswer: createLlmGroundedAnswerGenerator(input.config, llmFetch),
    businessToolFetch: toolFetch,
    allowBusinessToolMutations: false,
    maxConcurrentAnswersPerProject: input.config.maxConcurrentAnswersPerProject
  });

  return async (payload) => {
    const projectId = requiredPayloadString(payload, "project_id");
    const conversationId = requiredPayloadString(payload, "conversation_id");
    const messageId = requiredPayloadString(payload, "message_id");
    const message = await input.repository.findMessage(projectId, conversationId, messageId);
    if (!message || message.role !== "end_user") {
      throw new Error(`End-user source message not found: ${messageId}`);
    }

    const existingAnswer = await input.repository.findMessageByIdempotencyKey({
      projectId,
      conversationId,
      idempotencyKey: answerMessageIdempotencyKey(message.id)
    });
    const answer =
      existingAnswer ??
      (await orchestrator.respondToUserMessage({
        projectId,
        conversationId,
        message
      }));
    return {
      project_id: projectId,
      conversation_id: conversationId,
      source_message_id: message.id,
      answer_message_id: answer?.id,
      status: answer ? "completed" : "handoff"
    };
  };
}

export function createPrismaAnswerJobProcessor(input: {
  prisma: PrismaClient;
  config?: AnswerRuntimeConfig;
  llmFetch?: typeof fetch;
  toolFetch?: typeof fetch;
}): AnswerJobProcessor {
  return createAnswerJobProcessor({
    repository: new PrismaSupportRepository(input.prisma),
    config: input.config ?? loadAnswerRuntimeConfig(),
    llmFetch: input.llmFetch,
    toolFetch: input.toolFetch
  });
}

export function createLlmGroundedAnswerGenerator(
  config: Pick<AnswerRuntimeConfig, "encryptionKey" | "llmTimeoutMs">,
  fetchImpl?: typeof fetch
): GroundedAnswerGenerator {
  return async ({ userText, chunks, provider }) => {
    if (!provider) {
      throw new Error("LLM provider is required");
    }

    const client = new OpenAICompatibleClient({
      baseUrl: provider.baseUrl,
      apiKey: llmApiKey(provider, config.encryptionKey),
      model: provider.model,
      embeddingModel: provider.embeddingModel,
      timeoutMs: config.llmTimeoutMs,
      fetchImpl
    });
    const response = await client.generate({
      model: provider.model,
      temperature: 0.2,
      messages: groundedAnswerMessages(userText, chunks)
    });

    return {
      answer: response.text,
      provider: provider.provider,
      model: response.model,
      promptVersion: "v0.6",
      inputTokens: response.usage?.promptTokens,
      outputTokens: response.usage?.completionTokens,
      confidence: Math.min(1, 0.6 + chunks.length * 0.08),
      metadata: {
        generated_by: "openai_compatible_grounded_answer_v0.6",
        llm_base_url: provider.baseUrl,
        embedding_model: provider.embeddingModel
      }
    };
  };
}

function groundedAnswerMessages(
  userText: string,
  chunks: KnowledgeChunkRecord[]
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You are OpenSupportAI, a support assistant embedded in a product.",
        "Answer only from the provided knowledge snippets.",
        "If the snippets do not answer the question, say you cannot confirm from the current knowledge base and suggest human handoff.",
        "Keep the answer concise, practical, and in the same language as the customer."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Customer question:\n${userText}`,
        "Knowledge snippets:",
        chunks
          .map((chunk, index) => {
            const title =
              typeof chunk.metadata["title"] === "string" ? ` (${chunk.metadata["title"]})` : "";
            return `[${index + 1}]${title}\n${chunk.content}`;
          })
          .join("\n\n")
      ].join("\n\n")
    }
  ];
}

function llmApiKey(provider: LlmProviderRecord, encryptionKey: string): string {
  if (provider.apiKeyEncrypted.startsWith("v1.")) {
    return requiredConfigString(decryptJson(provider.apiKeyEncrypted, encryptionKey), "api_key");
  }
  if (provider.baseUrl === "demo://local") {
    return provider.apiKeyEncrypted;
  }
  throw new Error("Unsupported LLM API key format");
}

function requiredPayloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Answer job payload field is required: ${key}`);
  }
  return value;
}

function requiredConfigString(configPayload: JsonRecord, key: string): string {
  const value = configPayload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`LLM provider config is missing ${key}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Answer runtime numeric configuration must contain positive integers");
  }
  return parsed;
}
