import { describe, expect, it } from "vitest";
import { MemorySupportRepository } from "./memory";

describe("memory repository reliability contracts", () => {
  it("creates one source message and one answer job for repeated idempotent writes", async () => {
    const repository = await seededRepository();
    const contact = await repository.upsertContact("proj_demo", {
      externalUserId: "outbox_user"
    });
    const conversation = await repository.createConversation({
      projectId: "proj_demo",
      inboxId: "inbox_default",
      contactId: contact.id
    });
    const accept = () =>
      repository.createMessageWithAsyncJob({
        projectId: "proj_demo",
        conversationId: conversation.id,
        idempotencyKey: "outbox-message-1",
        idempotencyHash: "same-body-hash",
        message: { role: "end_user", text: "怎么取消订阅？" },
        job: { type: "answer.generate" }
      });

    const [first, duplicate] = await Promise.all([accept(), accept()]);
    expect(first.message.id).toBe(duplicate.message.id);
    expect(first.job.id).toBe(duplicate.job.id);
    expect([first.created, duplicate.created].sort()).toEqual([false, true]);
    await expect(
      repository.listAsyncJobs({ projectId: "proj_demo", type: "answer.generate" })
    ).resolves.toEqual([
      expect.objectContaining({
        deduplicationKey: `message:${first.message.id}`,
        payload: expect.objectContaining({
          project_id: "proj_demo",
          conversation_id: conversation.id,
          message_id: first.message.id
        })
      })
    ]);
  });

  it("claims a queued job only once and fences the owner", async () => {
    const repository = await seededRepository();
    const now = "2026-07-22T00:00:00.000Z";
    const job = await repository.createAsyncJob({
      projectId: "proj_demo",
      type: "knowledge.index",
      payload: { document_id: "doc_demo_billing" },
      runAt: now
    });
    const claims = await Promise.all([
      repository.claimNextAsyncJob({ workerId: "worker_1", now, leaseMs: 1000 }),
      repository.claimNextAsyncJob({ workerId: "worker_2", now, leaseMs: 1000 })
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims.find(Boolean)?.lockedBy;
    const nonOwner = owner === "worker_1" ? "worker_2" : "worker_1";
    await expect(
      repository.completeAsyncJob({ id: job.id, workerId: nonOwner, result: {} })
    ).rejects.toThrow("lease is not owned");
    await expect(
      repository.completeAsyncJob({ id: job.id, workerId: owner ?? "", result: { ok: true } })
    ).resolves.toMatchObject({ status: "completed", result: { ok: true } });
  });

  it("recovers an expired lease and fails an exhausted stale job", async () => {
    const repository = await seededRepository();
    const firstAttemptAt = "2026-07-22T00:00:00.000Z";
    const recoverable = await repository.createAsyncJob({
      projectId: "proj_demo",
      type: "knowledge.index",
      maxAttempts: 2,
      runAt: firstAttemptAt
    });
    await repository.claimNextAsyncJob({
      workerId: "worker_1",
      now: firstAttemptAt,
      leaseMs: 1000
    });
    const recovered = await repository.claimNextAsyncJob({
      workerId: "worker_2",
      now: "2026-07-22T00:00:01.001Z",
      leaseMs: 1000
    });
    expect(recovered).toMatchObject({
      id: recoverable.id,
      attempts: 2,
      lockedBy: "worker_2",
      status: "running"
    });

    const exhausted = await repository.createAsyncJob({
      projectId: "proj_demo",
      type: "knowledge.index",
      maxAttempts: 1,
      runAt: "2026-07-22T00:00:02.000Z"
    });
    await repository.claimNextAsyncJob({
      workerId: "worker_3",
      now: "2026-07-22T00:00:02.000Z",
      leaseMs: 1000
    });
    await repository.claimNextAsyncJob({
      workerId: "worker_4",
      now: "2026-07-22T00:00:03.001Z",
      leaseMs: 1000
    });
    const failed = await repository.listAsyncJobs({
      projectId: "proj_demo",
      status: "failed"
    });
    expect(failed).toContainEqual(
      expect.objectContaining({
        id: exhausted.id,
        error: "Job lease expired after the maximum number of attempts"
      })
    );
  });

  it("allows only one processor to claim a webhook event", async () => {
    const repository = await seededRepository();
    const first = await repository.createWebhookEvent({
      projectId: "proj_demo",
      provider: "generic_webhook",
      externalEventId: "event_once",
      payload: { event_id: "event_once" }
    });
    const duplicate = await repository.createWebhookEvent({
      projectId: "proj_demo",
      provider: "generic_webhook",
      externalEventId: "event_once",
      payload: { event_id: "event_once" }
    });
    expect(duplicate.id).toBe(first.id);

    const claims = await Promise.all([
      repository.claimWebhookEvent({ projectId: "proj_demo", id: first.id }),
      repository.claimWebhookEvent({ projectId: "proj_demo", id: first.id })
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.at(-1)?.event).toMatchObject({ status: "processing", attempts: 1 });
  });
});

async function seededRepository(): Promise<MemorySupportRepository> {
  const repository = new MemorySupportRepository();
  await repository.seedDemo();
  return repository;
}
