import assert from "node:assert/strict";

process.env["WORKER_AUTOSTART"] = "false";

const [
  { ANSWER_GENERATE_JOB_TYPE, createAnswerJobProcessor },
  { PrismaSupportRepository },
  worker,
  { createPrismaClient }
] = await Promise.all([
  import("../services/api/src/answer-runtime"),
  import("../services/api/src/repositories/prisma"),
  import("../services/worker/src/index"),
  import("../services/worker/src/prisma-client")
]);

const prisma = createPrismaClient();
const repository = new PrismaSupportRepository(prisma);

try {
  const inbox = await repository.findInbox("proj_demo", "inbox_default");
  assert(inbox, "Seeded demo inbox is required");
  const suffix = Date.now().toString(36);
  const contact = await repository.upsertContact("proj_demo", {
    externalUserId: `postgres-answer-smoke-${suffix}`
  });
  const conversation = await repository.createConversation({
    projectId: "proj_demo",
    inboxId: inbox.id,
    contactId: contact.id
  });
  const accept = () =>
    repository.createMessageWithAsyncJob({
      projectId: "proj_demo",
      conversationId: conversation.id,
      idempotencyKey: `postgres-answer-${suffix}`,
      idempotencyHash: "same-request-body",
      message: { role: "end_user", text: "怎么取消订阅？" },
      job: { type: ANSWER_GENERATE_JOB_TYPE }
    });

  const [first, duplicate] = await Promise.all([accept(), accept()]);
  assert.equal(first.message.id, duplicate.message.id);
  assert.equal(first.job.id, duplicate.job.id);
  assert.deepEqual([first.created, duplicate.created].sort(), [false, true]);

  const answerProcessor = createAnswerJobProcessor({
    repository,
    config: {
      encryptionKey: "postgres_smoke_encryption_key",
      allowPrivateOutbound: false,
      llmTimeoutMs: 5_000,
      maxConcurrentAnswersPerProject: 1
    }
  });
  const runtime = worker.createWorkerRuntime({
    queue: worker.createPrismaWorkerQueue(prisma),
    handlers: {
      [ANSWER_GENERATE_JOB_TYPE]: worker.createAnswerGenerateHandler(answerProcessor)
    },
    config: {
      workerId: `postgres-smoke-${suffix}`,
      jobTypes: [ANSWER_GENERATE_JOB_TYPE],
      leaseMs: 10_000,
      retryDelayMs: 100
    }
  });

  assert.equal(await runtime.runOnce(), "processed");
  const replay = await answerProcessor(first.job.payload);
  const messages = await repository.listMessages("proj_demo", conversation.id);
  const jobs = await repository.listAsyncJobs({
    projectId: "proj_demo",
    type: ANSWER_GENERATE_JOB_TYPE
  });
  const aiRuns = await repository.listAiRuns("proj_demo", conversation.id);
  const answers = messages.filter((message) => message.role === "ai_agent");

  assert.equal(answers.length, 1);
  assert.equal(aiRuns.length, 1);
  assert.equal(replay.answer_message_id, answers[0]?.id);
  assert.equal(jobs.find((job) => job.id === first.job.id)?.status, "completed");
  assert.equal(jobs.find((job) => job.id === first.job.id)?.attempts, 1);

  console.log(
    JSON.stringify({
      status: "ok",
      conversation_id: conversation.id,
      source_message_id: first.message.id,
      answer_message_id: answers[0]?.id,
      job_id: first.job.id
    })
  );
} finally {
  await prisma.$disconnect();
}
