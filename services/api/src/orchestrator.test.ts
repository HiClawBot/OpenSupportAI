import { describe, expect, it } from "vitest";
import { EventHub } from "./event-hub";
import { createOrchestrator, type GroundedAnswerGeneration } from "./orchestrator";
import { MemorySupportRepository } from "./repositories/memory";

describe("orchestrator reliability", () => {
  it("records an explicit degraded answer when project concurrency is saturated", async () => {
    const repository = new MemorySupportRepository();
    await repository.seedDemo();
    await repository.upsertLlmProvider({
      projectId: "proj_demo",
      provider: "openai_compatible",
      baseUrl: "https://llm.example.test/v1",
      model: "support-model",
      apiKeyEncrypted: "test",
      status: "active"
    });
    const inbox = await repository.findInbox("proj_demo", "inbox_default");
    const firstContact = await repository.upsertContact("proj_demo", {
      externalUserId: "concurrency_user_1"
    });
    const secondContact = await repository.upsertContact("proj_demo", {
      externalUserId: "concurrency_user_2"
    });
    const firstConversation = await repository.createConversation({
      projectId: "proj_demo",
      inboxId: inbox?.id ?? "inbox_default",
      contactId: firstContact.id
    });
    const secondConversation = await repository.createConversation({
      projectId: "proj_demo",
      inboxId: inbox?.id ?? "inbox_default",
      contactId: secondContact.id
    });
    const firstMessage = await repository.createMessage({
      projectId: "proj_demo",
      conversationId: firstConversation.id,
      message: { role: "end_user", text: "账单设置页面在哪里？" }
    });
    const secondMessage = await repository.createMessage({
      projectId: "proj_demo",
      conversationId: secondConversation.id,
      message: { role: "end_user", text: "账单设置页面在哪里？" }
    });
    const generation = deferred<GroundedAnswerGeneration>();
    const started = deferred<void>();
    const orchestrator = createOrchestrator(repository, new EventHub(), {
      maxConcurrentAnswersPerProject: 1,
      generateGroundedAnswer: async () => {
        started.resolve();
        return generation.promise;
      }
    });

    const firstRun = orchestrator.respondToUserMessage({
      projectId: "proj_demo",
      conversationId: firstConversation.id,
      message: firstMessage
    });
    await started.promise;
    await orchestrator.respondToUserMessage({
      projectId: "proj_demo",
      conversationId: secondConversation.id,
      message: secondMessage
    });
    generation.resolve({
      answer: "Use the billing settings page.",
      provider: "openai_compatible",
      model: "support-model",
      promptVersion: "test"
    });
    await firstRun;

    const secondMessages = await repository.listMessages("proj_demo", secondConversation.id);
    expect(secondMessages.at(-1)?.metadata).toMatchObject({
      degraded: true,
      reason: "project_concurrency_limit",
      retryable: true
    });
    const secondRuns = await repository.listAiRuns("proj_demo", secondConversation.id);
    expect(secondRuns[0]).toMatchObject({
      status: "failed",
      error: "Project answer concurrency limit reached"
    });
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value?: T) {
      resolvePromise(value as T);
    }
  };
}
