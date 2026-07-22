import type { ClientEvent, HandoffReason, SourceReference } from "@opensupportai/protocol";
import type { EventHub } from "./event-hub";
import type {
  HandoffSessionRecord,
  JsonRecord,
  KnowledgeChunkRecord,
  LlmProviderRecord,
  MessageRecord,
  SupportRepository
} from "./repositories/types";
import { maybeRunBusinessTool } from "./business-tools";

export type Orchestrator = {
  respondToUserMessage(input: {
    projectId: string;
    conversationId: string;
    message: MessageRecord;
  }): Promise<MessageRecord | undefined>;
};

export type RequestHandoffHandler = (input: {
  projectId: string;
  conversationId: string;
  reason: HandoffReason;
  note?: string;
}) => Promise<HandoffSessionRecord>;

export type GroundedAnswerGeneration = {
  answer: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  confidence?: number;
  metadata?: JsonRecord;
};

export type GroundedAnswerGenerator = (input: {
  projectId: string;
  conversationId: string;
  userText: string;
  chunks: KnowledgeChunkRecord[];
  provider?: LlmProviderRecord;
}) => Promise<GroundedAnswerGeneration>;

export function createOrchestrator(
  repository: SupportRepository,
  eventHub: EventHub,
  options: {
    requestHandoff?: RequestHandoffHandler;
    generateGroundedAnswer?: GroundedAnswerGenerator;
    businessToolFetch?: typeof fetch;
    allowBusinessToolMutations?: boolean;
    maxConcurrentAnswersPerProject?: number;
  } = {}
): Orchestrator {
  const handoffHandler =
    options.requestHandoff ??
    ((input) =>
      requestHandoff(
        repository,
        eventHub,
        input.projectId,
        input.conversationId,
        input.reason,
        input.note
      ));
  const activeAnswersByProject = new Map<string, number>();
  const maxConcurrentAnswersPerProject = options.maxConcurrentAnswersPerProject ?? 4;

  return {
    async respondToUserMessage(input) {
      const existingAnswer = await repository.findMessageByIdempotencyKey({
        projectId: input.projectId,
        conversationId: input.conversationId,
        idempotencyKey: answerMessageIdempotencyKey(input.message.id)
      });
      if (existingAnswer) {
        publishCompletion(eventHub, input.projectId, input.conversationId, existingAnswer);
        return existingAnswer;
      }
      const activeAnswers = activeAnswersByProject.get(input.projectId) ?? 0;
      if (activeAnswers >= maxConcurrentAnswersPerProject) {
        return respondAtCapacity(repository, eventHub, input);
      }
      activeAnswersByProject.set(input.projectId, activeAnswers + 1);
      try {
        const text = textFromMessage(input.message);

        if (detectHandoffIntent(text)) {
          await repository.createAiRun({
            projectId: input.projectId,
            conversationId: input.conversationId,
            provider: "opensupportai",
            model: "handoff-detector",
            promptVersion: "v0.1",
            retrievedChunkIds: [],
            confidence: 1,
            status: "handoff",
            metadata: {
              reason: "user_requested"
            }
          });
          await handoffHandler({
            projectId: input.projectId,
            conversationId: input.conversationId,
            reason: "user_requested"
          });
          return undefined;
        }

        const startedAt = Date.now();
        const toolResult = await maybeRunBusinessTool(
          repository,
          {
            projectId: input.projectId,
            conversationId: input.conversationId,
            text
          },
          {
            fetchImpl: options.businessToolFetch,
            allowMutations: options.allowBusinessToolMutations
          }
        );
        if (toolResult) {
          const answerResult = await createAnswerMessage(repository, input, {
            role: "ai_agent",
            text: toolResult.answer,
            metadata: {
              grounded: true,
              tool_slug: toolResult.tool.slug,
              tool_call_id: toolResult.toolCall.id
            }
          });
          const message = answerResult.message;

          if (answerResult.created) {
            await repository.createAiRun({
              projectId: input.projectId,
              conversationId: input.conversationId,
              messageId: message.id,
              provider: "opensupportai",
              model: "demo-business-tool",
              promptVersion: "v0.3",
              inputTokens: text.length,
              outputTokens: toolResult.answer.length,
              latencyMs: Date.now() - startedAt,
              retrievedChunkIds: [],
              confidence: 0.9,
              status: "completed",
              metadata: {
                tool_slug: toolResult.tool.slug,
                tool_call_id: toolResult.toolCall.id
              }
            });
          }

          publishCompletion(eventHub, input.projectId, input.conversationId, message);
          return message;
        }

        const chunks = await repository.retrieveKnowledge(input.projectId, text, 6);
        const provider = await repository.getActiveLlmProvider(input.projectId);

        if (chunks.length === 0) {
          const answerResult = await createAnswerMessage(repository, input, {
            role: "ai_agent",
            text: "我暂时无法根据当前知识库确认答案。为了避免误导你，建议转人工客服处理。",
            metadata: {
              no_hit: true
            }
          });
          const message = answerResult.message;

          if (answerResult.created) {
            await repository.createAiRun({
              projectId: input.projectId,
              conversationId: input.conversationId,
              messageId: message.id,
              provider: provider?.provider ?? "opensupportai",
              model: provider?.model ?? "no-knowledge-fallback",
              promptVersion: "v0.1",
              inputTokens: text.length,
              outputTokens: textFromMessage(message).length,
              latencyMs: Date.now() - startedAt,
              retrievedChunkIds: [],
              confidence: 0,
              status: "skipped",
              metadata: {
                policy: "rag_no_hit_no_hallucination"
              }
            });
          }

          publishCompletion(eventHub, input.projectId, input.conversationId, message);
          return message;
        }

        const generation = await generateGroundedAnswer({
          generator: options.generateGroundedAnswer,
          projectId: input.projectId,
          conversationId: input.conversationId,
          userText: text,
          chunks,
          provider
        });
        const answer = generation.answer;
        for (const delta of splitDeltas(answer)) {
          eventHub.publish(input.projectId, input.conversationId, {
            event: "ai.delta",
            data: {
              conversationId: input.conversationId,
              text: delta
            }
          });
        }

        const sourceRefs = chunks.map(sourceRefFromChunk);
        const answerResult = await createAnswerMessage(repository, input, {
          role: "ai_agent",
          text: answer,
          sourceRefs,
          metadata: {
            grounded: true,
            generated_by: generation.metadata?.["generated_by"] ?? "grounded_answer_v0.6"
          }
        });
        const message = answerResult.message;

        if (answerResult.created) {
          await repository.createAiRun({
            projectId: input.projectId,
            conversationId: input.conversationId,
            messageId: message.id,
            provider: generation.provider,
            model: generation.model,
            promptVersion: generation.promptVersion,
            inputTokens: generation.inputTokens ?? text.length,
            outputTokens: generation.outputTokens ?? answer.length,
            latencyMs: Date.now() - startedAt,
            retrievedChunkIds: chunks.map((chunk) => chunk.id),
            confidence: generation.confidence ?? Math.min(1, 0.45 + chunks.length * 0.12),
            status: "completed",
            metadata: {
              ...generation.metadata,
              source_chunk_count: chunks.length
            }
          });
        }
        publishCompletion(eventHub, input.projectId, input.conversationId, message);
        return message;
      } finally {
        const remaining = (activeAnswersByProject.get(input.projectId) ?? 1) - 1;
        if (remaining > 0) {
          activeAnswersByProject.set(input.projectId, remaining);
        } else {
          activeAnswersByProject.delete(input.projectId);
        }
      }
    }
  };
}

async function respondAtCapacity(
  repository: SupportRepository,
  eventHub: EventHub,
  input: { projectId: string; conversationId: string; message: MessageRecord }
): Promise<MessageRecord> {
  const text = "当前请求较多，我暂时无法处理这条消息。请稍后重试，或转人工客服继续处理。";
  const answerResult = await createAnswerMessage(repository, input, {
    role: "ai_agent",
    text,
    metadata: {
      degraded: true,
      reason: "project_concurrency_limit",
      retryable: true
    }
  });
  const message = answerResult.message;
  if (answerResult.created) {
    await repository.createAiRun({
      projectId: input.projectId,
      conversationId: input.conversationId,
      messageId: message.id,
      provider: "opensupportai",
      model: "project-concurrency-gate",
      promptVersion: "v1.1-beta",
      inputTokens: textFromMessage(input.message).length,
      outputTokens: text.length,
      retrievedChunkIds: [],
      confidence: 0,
      status: "failed",
      error: "Project answer concurrency limit reached",
      metadata: {
        degraded: true,
        reason: "project_concurrency_limit",
        retryable: true
      }
    });
  }
  publishCompletion(eventHub, input.projectId, input.conversationId, message);
  return message;
}

export async function requestHandoff(
  repository: SupportRepository,
  eventHub: EventHub,
  projectId: string,
  conversationId: string,
  reason: HandoffReason,
  note?: string
): Promise<HandoffSessionRecord> {
  const handoffSession = await repository.createHandoffSession({
    projectId,
    conversationId,
    provider: "chatwoot",
    reason,
    metadata: note ? { note } : {}
  });
  const conversation = await repository.updateConversationStatus({
    projectId,
    conversationId,
    status: "handoff_requested",
    assigneeType: "human"
  });
  eventHub.publish(projectId, conversationId, {
    event: "conversation.status_changed",
    data: {
      conversationId,
      status: conversation.status
    }
  });
  eventHub.publish(projectId, conversationId, {
    event: "handoff.requested",
    data: {
      conversationId,
      reason
    }
  });
  return handoffSession;
}

function textFromMessage(message: MessageRecord): string {
  const text = message.content["text"];
  return typeof text === "string" ? text : "";
}

export function detectHandoffIntent(text: string): boolean {
  return /转人工|人工|真人|客服|human|agent/i.test(text);
}

export function answerMessageIdempotencyKey(sourceMessageId: string): string {
  return `answer:${sourceMessageId}`;
}

async function createAnswerMessage(
  repository: SupportRepository,
  input: { projectId: string; conversationId: string; message: MessageRecord },
  message: Parameters<SupportRepository["createMessage"]>[0]["message"]
): Promise<{ message: MessageRecord; created: boolean }> {
  return repository.createIdempotentMessage({
    projectId: input.projectId,
    conversationId: input.conversationId,
    idempotencyKey: answerMessageIdempotencyKey(input.message.id),
    idempotencyHash: `answer-v1:${input.message.id}`,
    message
  });
}

function buildGroundedAnswer(chunks: KnowledgeChunkRecord[]): string {
  const primary = chunks[0];
  const body = primary?.content.trim() ?? "";
  return `根据知识库，${body}\n\n如果你的问题涉及账号、账单、退款或隐私数据，我可以帮你转人工继续处理。`;
}

async function generateGroundedAnswer(input: {
  generator?: GroundedAnswerGenerator;
  projectId: string;
  conversationId: string;
  userText: string;
  chunks: KnowledgeChunkRecord[];
  provider?: LlmProviderRecord;
}): Promise<GroundedAnswerGeneration> {
  const deterministic = deterministicGroundedAnswer(input.chunks, input.provider);
  if (!input.provider || input.provider.baseUrl === "demo://local" || !input.generator) {
    return deterministic;
  }

  try {
    const generation = await input.generator({
      projectId: input.projectId,
      conversationId: input.conversationId,
      userText: input.userText,
      chunks: input.chunks,
      provider: input.provider
    });
    const answer = generation.answer.trim();
    if (!answer) {
      return {
        ...deterministic,
        metadata: {
          ...deterministic.metadata,
          llm_fallback: true,
          llm_error: "LLM returned an empty answer"
        }
      };
    }
    return {
      ...generation,
      answer,
      metadata: {
        ...generation.metadata,
        llm_generated: true
      }
    };
  } catch (error) {
    return {
      ...deterministic,
      provider: input.provider.provider,
      model: input.provider.model,
      promptVersion: "v0.6",
      metadata: {
        ...deterministic.metadata,
        llm_fallback: true,
        llm_error: error instanceof Error ? error.message : "Unknown LLM generation error"
      }
    };
  }
}

function deterministicGroundedAnswer(
  chunks: KnowledgeChunkRecord[],
  provider?: LlmProviderRecord
): GroundedAnswerGeneration {
  const answer = buildGroundedAnswer(chunks);
  return {
    answer,
    provider: provider?.provider ?? "opensupportai",
    model: provider?.model ?? "deterministic-grounded-answer",
    promptVersion: "v0.6",
    inputTokens: undefined,
    outputTokens: answer.length,
    confidence: Math.min(1, 0.45 + chunks.length * 0.12),
    metadata: {
      generated_by: "deterministic_grounded_answer_v0.6",
      demo_model: provider?.baseUrl === "demo://local" || !provider
    }
  };
}

function sourceRefFromChunk(chunk: KnowledgeChunkRecord): SourceReference {
  const title = typeof chunk.metadata["title"] === "string" ? chunk.metadata["title"] : undefined;
  const uri =
    typeof chunk.metadata["source_uri"] === "string" ? chunk.metadata["source_uri"] : undefined;
  return {
    documentId: chunk.documentId,
    chunkId: chunk.id,
    title,
    uri
  };
}

function splitDeltas(text: string): string[] {
  const deltas: string[] = [];
  for (let index = 0; index < text.length; index += 18) {
    deltas.push(text.slice(index, index + 18));
  }
  return deltas;
}

function publishCompletion(
  eventHub: EventHub,
  projectId: string,
  conversationId: string,
  message: MessageRecord
): void {
  const event: ClientEvent = {
    event: "ai.message.completed",
    data: {
      message
    }
  };
  eventHub.publish(projectId, conversationId, event);
}
