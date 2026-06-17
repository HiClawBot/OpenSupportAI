import type { ClientEvent, HandoffReason, SourceReference } from "@opensupportai/protocol";
import type { EventHub } from "./event-hub";
import type {
  HandoffSessionRecord,
  KnowledgeChunkRecord,
  MessageRecord,
  SupportRepository
} from "./repositories/types";
import { maybeRunBusinessTool } from "./business-tools";

export type Orchestrator = {
  respondToUserMessage(input: {
    projectId: string;
    conversationId: string;
    message: MessageRecord;
  }): Promise<void>;
};

export type RequestHandoffHandler = (input: {
  projectId: string;
  conversationId: string;
  reason: HandoffReason;
  note?: string;
}) => Promise<HandoffSessionRecord>;

export function createOrchestrator(
  repository: SupportRepository,
  eventHub: EventHub,
  options: {
    requestHandoff?: RequestHandoffHandler;
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

  return {
    async respondToUserMessage(input) {
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
        return;
      }

      const startedAt = Date.now();
      const toolResult = await maybeRunBusinessTool(repository, {
        projectId: input.projectId,
        conversationId: input.conversationId,
        text
      });
      if (toolResult) {
        const message = await repository.createMessage({
          projectId: input.projectId,
          conversationId: input.conversationId,
          message: {
            role: "ai_agent",
            text: toolResult.answer,
            metadata: {
              grounded: true,
              tool_slug: toolResult.tool.slug,
              tool_call_id: toolResult.toolCall.id
            }
          }
        });

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

        publishCompletion(eventHub, input.projectId, input.conversationId, message);
        return;
      }

      const chunks = await repository.retrieveKnowledge(input.projectId, text, 6);
      const provider = await repository.getActiveLlmProvider(input.projectId);

      if (chunks.length === 0) {
        const message = await repository.createMessage({
          projectId: input.projectId,
          conversationId: input.conversationId,
          message: {
            role: "ai_agent",
            text: "我暂时无法根据当前知识库确认答案。为了避免误导你，建议转人工客服处理。",
            metadata: {
              no_hit: true
            }
          }
        });

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

        publishCompletion(eventHub, input.projectId, input.conversationId, message);
        return;
      }

      const answer = buildGroundedAnswer(chunks);
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
      const message = await repository.createMessage({
        projectId: input.projectId,
        conversationId: input.conversationId,
        message: {
          role: "ai_agent",
          text: answer,
          sourceRefs,
          metadata: {
            grounded: true
          }
        }
      });

      await repository.createAiRun({
        projectId: input.projectId,
        conversationId: input.conversationId,
        messageId: message.id,
        provider: provider?.provider ?? "openai_compatible",
        model: provider?.model ?? "demo-support-model",
        promptVersion: "v0.1",
        inputTokens: text.length,
        outputTokens: answer.length,
        latencyMs: Date.now() - startedAt,
        retrievedChunkIds: chunks.map((chunk) => chunk.id),
        confidence: Math.min(1, 0.45 + chunks.length * 0.12),
        status: "completed",
        metadata: {
          demo_model: provider?.baseUrl === "demo://local" || !provider
        }
      });

      publishCompletion(eventHub, input.projectId, input.conversationId, message);
    }
  };
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

function detectHandoffIntent(text: string): boolean {
  return /转人工|人工|真人|客服|human|agent/i.test(text);
}

function buildGroundedAnswer(chunks: KnowledgeChunkRecord[]): string {
  const primary = chunks[0];
  const body = primary?.content.trim() ?? "";
  return `根据知识库，${body}\n\n如果你的问题涉及账号、账单、退款或隐私数据，我可以帮你转人工继续处理。`;
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
