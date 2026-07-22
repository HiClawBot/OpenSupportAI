import { describe, expect, it } from "vitest";
import { createAnswerJobProcessor } from "./answer-runtime";
import { MemorySupportRepository } from "./repositories/memory";

describe("answer job runtime", () => {
  it("produces one durable answer when the same job is replayed", async () => {
    const repository = new MemorySupportRepository();
    await repository.seedDemo();
    const contact = await repository.upsertContact("proj_demo", {
      externalUserId: "answer_runtime_user"
    });
    const conversation = await repository.createConversation({
      projectId: "proj_demo",
      inboxId: "inbox_default",
      contactId: contact.id
    });
    const sourceMessage = await repository.createMessage({
      projectId: "proj_demo",
      conversationId: conversation.id,
      message: { role: "end_user", text: "怎么取消订阅？" }
    });
    const processor = createAnswerJobProcessor({
      repository,
      config: {
        encryptionKey: "test_encryption_key",
        allowPrivateOutbound: true,
        llmTimeoutMs: 1_000,
        maxConcurrentAnswersPerProject: 1
      }
    });
    const payload = {
      project_id: "proj_demo",
      conversation_id: conversation.id,
      message_id: sourceMessage.id
    };

    const first = await processor(payload);
    const replay = await processor(payload);
    const messages = await repository.listMessages("proj_demo", conversation.id);
    const aiRuns = await repository.listAiRuns("proj_demo", conversation.id);

    expect(first.status).toBe("completed");
    expect(replay.answer_message_id).toBe(first.answer_message_id);
    expect(messages.filter((message) => message.role === "ai_agent")).toHaveLength(1);
    expect(aiRuns).toHaveLength(1);
  });

  it("does not execute mutation tools from a retryable answer job", async () => {
    const repository = new MemorySupportRepository();
    await repository.seedDemo();
    await repository.upsertToolDefinition({
      projectId: "proj_demo",
      slug: "openapi.refund_create",
      name: "Refund create",
      description: "Creates an approved refund.",
      kind: "openapi",
      status: "active",
      method: "POST",
      path: "https://tools.example.test/refunds",
      inputSchema: { type: "object", required: ["order_id"] },
      metadata: {
        allowed_hosts: ["tools.example.test"],
        allow_mutation: true,
        mutation_approval: {
          status: "approved",
          approved_by: "operator@example.com",
          approved_at: "2026-07-22T00:00:00.000Z"
        },
        intent: {
          keywords: ["创建退款"],
          extract: { field: "order_id", pattern: "EXT-\\d{4}-\\d{4}" }
        }
      }
    });
    const contact = await repository.upsertContact("proj_demo", {
      externalUserId: "answer_mutation_user"
    });
    const conversation = await repository.createConversation({
      projectId: "proj_demo",
      inboxId: "inbox_default",
      contactId: contact.id
    });
    const sourceMessage = await repository.createMessage({
      projectId: "proj_demo",
      conversationId: conversation.id,
      message: { role: "end_user", text: "请创建退款 EXT-2026-9002" }
    });
    let outboundCalls = 0;
    const processor = createAnswerJobProcessor({
      repository,
      config: {
        encryptionKey: "test_encryption_key",
        allowPrivateOutbound: true,
        llmTimeoutMs: 1_000,
        maxConcurrentAnswersPerProject: 1
      },
      toolFetch: async () => {
        outboundCalls += 1;
        return new Response("{}", { status: 200 });
      }
    });

    await processor({
      project_id: "proj_demo",
      conversation_id: conversation.id,
      message_id: sourceMessage.id
    });
    const toolCalls = await repository.listToolCalls({
      projectId: "proj_demo",
      conversationId: conversation.id
    });

    expect(outboundCalls).toBe(0);
    expect(toolCalls).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error: "OpenAPI tool mutations are disabled in asynchronous answer workers"
      })
    );
  });
});
