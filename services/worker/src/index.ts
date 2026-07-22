import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  ANSWER_GENERATE_JOB_TYPE,
  createPrismaAnswerJobProcessor,
  type AnswerJobProcessor
} from "@opensupportai/api/answer-runtime";
import { indexTextDocument } from "@opensupportai/rag";
import { createPrismaClient } from "./prisma-client";

export type WorkerJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type WorkerJob = {
  id: string;
  type: string;
  status: WorkerJobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  leaseExpiresAt?: string;
};

export type WorkerJobQueue = {
  claimNext(input: {
    workerId: string;
    types?: string[];
    leaseMs: number;
  }): Promise<WorkerJob | undefined>;
  renewLease(input: { id: string; workerId: string; leaseMs: number }): Promise<void>;
  complete(input: {
    id: string;
    workerId: string;
    result?: Record<string, unknown>;
  }): Promise<void>;
  fail(input: { id: string; workerId: string; error: string; retryAt?: string }): Promise<void>;
};

export type WorkerJobHandler = (job: WorkerJob) => Promise<Record<string, unknown> | void>;

export type WorkerRuntimeConfig = {
  workerId: string;
  pollIntervalMs: number;
  retryDelayMs: number;
  leaseMs: number;
  jobTypes: string[];
};

export type WorkerRuntime = {
  runOnce(): Promise<"processed" | "idle" | "busy">;
  start(): { stop(): Promise<void> };
};

export type KnowledgeIndexDocument = {
  id: string;
  projectId: string;
  title: string;
  sourceUri?: string;
  content: string;
  metadata: Record<string, unknown>;
};

export type KnowledgeIndexStore = {
  getDocument(input: {
    projectId: string;
    documentId: string;
  }): Promise<KnowledgeIndexDocument | undefined>;
  markIndexing(input: {
    projectId: string;
    documentId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  replaceChunks(input: {
    projectId: string;
    documentId: string;
    chunks: Array<{
      id: string;
      chunkIndex: number;
      content: string;
      tokenCount?: number;
      metadata: Record<string, unknown>;
    }>;
  }): Promise<void>;
  markIndexed(input: {
    projectId: string;
    documentId: string;
    contentHash: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  markFailed(input: {
    projectId: string;
    documentId: string;
    error: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

export const workerRuntimeConfig: WorkerRuntimeConfig = {
  workerId: process.env["WORKER_ID"] ?? `worker_${Math.random().toString(16).slice(2)}`,
  pollIntervalMs: Number(process.env["WORKER_POLL_INTERVAL_MS"] ?? 5_000),
  retryDelayMs: Number(process.env["WORKER_RETRY_DELAY_MS"] ?? 30_000),
  leaseMs: Number(process.env["WORKER_LEASE_MS"] ?? 60_000),
  jobTypes: parseJobTypes(process.env["WORKER_JOB_TYPES"])
};

export function createWorkerRuntime(input: {
  queue: WorkerJobQueue;
  handlers: Record<string, WorkerJobHandler>;
  config?: Partial<WorkerRuntimeConfig>;
  now?: () => Date;
}): WorkerRuntime {
  const config: WorkerRuntimeConfig = {
    ...workerRuntimeConfig,
    ...input.config,
    jobTypes: input.config?.jobTypes ?? Object.keys(input.handlers)
  };
  validateWorkerRuntimeConfig(config);
  const now = input.now ?? (() => new Date());
  let activeRun: Promise<"processed" | "idle"> | undefined;

  const processOne = async (): Promise<"processed" | "idle"> => {
    const job = await input.queue.claimNext({
      workerId: config.workerId,
      types: config.jobTypes,
      leaseMs: config.leaseMs
    });
    if (!job) {
      return "idle";
    }

    const handler = input.handlers[job.type];
    if (!handler) {
      await input.queue.fail({
        id: job.id,
        workerId: config.workerId,
        error: `No handler registered for job type: ${job.type}`
      });
      return "processed";
    }

    const heartbeat = setInterval(
      () => {
        void input.queue
          .renewLease({ id: job.id, workerId: config.workerId, leaseMs: config.leaseMs })
          .catch((error) => {
            console.error(error instanceof Error ? error.message : "Worker lease renewal failed");
          });
      },
      Math.max(100, Math.floor(config.leaseMs / 3))
    );
    try {
      const result = await handler(job);
      await input.queue.complete({
        id: job.id,
        workerId: config.workerId,
        result: result ?? {}
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      await input.queue.fail({
        id: job.id,
        workerId: config.workerId,
        error: message,
        retryAt:
          job.attempts < job.maxAttempts
            ? new Date(now().getTime() + config.retryDelayMs).toISOString()
            : undefined
      });
    } finally {
      clearInterval(heartbeat);
    }

    return "processed";
  };

  const runtime: WorkerRuntime = {
    async runOnce() {
      if (activeRun) {
        return "busy";
      }
      activeRun = processOne();
      try {
        return await activeRun;
      } finally {
        activeRun = undefined;
      }
    },
    start() {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async () => {
        if (stopped) {
          return;
        }
        try {
          await runtime.runOnce();
        } catch (error) {
          console.error(error instanceof Error ? error.message : "Worker run failed");
        }
        if (!stopped) {
          timer = setTimeout(() => void tick(), config.pollIntervalMs);
        }
      };
      timer = setTimeout(() => void tick(), 0);

      return {
        async stop() {
          stopped = true;
          if (timer) {
            clearTimeout(timer);
          }
          await activeRun;
        }
      };
    }
  };
  return runtime;
}

export function createKnowledgeIndexHandler(store: KnowledgeIndexStore): WorkerJobHandler {
  return async (job) => {
    const projectId = requiredPayloadString(job.payload, "project_id");
    const documentId = requiredPayloadString(job.payload, "document_id");
    const document = await store.getDocument({ projectId, documentId });
    if (!document) {
      throw new Error(`Knowledge document not found: ${documentId}`);
    }

    const indexingMetadata = {
      ...document.metadata,
      last_index_job_id: job.id,
      indexing_started_at: new Date().toISOString()
    };

    await store.markIndexing({
      projectId,
      documentId,
      metadata: indexingMetadata
    });

    try {
      if (!document.content.trim()) {
        throw new Error("Knowledge document content is empty");
      }
      const chunkMetadata = {
        ...document.metadata,
        title: document.title,
        source_uri: document.sourceUri
      };
      const chunks = indexTextDocument({
        projectId,
        documentId,
        content: document.content,
        metadata: chunkMetadata
      }).map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        metadata: chunkMetadata
      }));

      await store.replaceChunks({
        projectId,
        documentId,
        chunks
      });
      await store.markIndexed({
        projectId,
        documentId,
        contentHash: hash(document.content),
        metadata: {
          ...document.metadata,
          chunk_count: chunks.length,
          indexed_at: new Date().toISOString(),
          last_index_job_id: job.id
        }
      });

      return {
        indexed_document_id: documentId,
        chunk_count: chunks.length
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown knowledge indexing error";
      await store.markFailed({
        projectId,
        documentId,
        error: message,
        metadata: {
          ...document.metadata,
          last_index_job_id: job.id,
          failed_at: new Date().toISOString()
        }
      });
      throw error;
    }
  };
}

export function createAnswerGenerateHandler(processor: AnswerJobProcessor): WorkerJobHandler {
  return async (job) => processor(job.payload);
}

export function createDefaultWorkerHandlers(input: {
  knowledgeStore: KnowledgeIndexStore;
  answerProcessor?: AnswerJobProcessor;
}): Record<string, WorkerJobHandler> {
  return {
    "knowledge.index": createKnowledgeIndexHandler(input.knowledgeStore),
    ...(input.answerProcessor
      ? { [ANSWER_GENERATE_JOB_TYPE]: createAnswerGenerateHandler(input.answerProcessor) }
      : {})
  };
}

export function createPrismaWorkerQueue(
  prisma: PrismaClient = createPrismaClient()
): WorkerJobQueue {
  return {
    async claimNext(input) {
      const nowValue = new Date();
      const leaseExpiresAt = new Date(nowValue.getTime() + input.leaseMs);
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "async_jobs"
        SET
          "status" = 'failed',
          "locked_by" = NULL,
          "locked_at" = NULL,
          "lease_expires_at" = NULL,
          "error" = 'Job lease expired after the maximum number of attempts',
          "updated_at" = ${nowValue}
        WHERE
          "status" = 'running'
          AND "lease_expires_at" <= ${nowValue}
          AND "attempts" >= "max_attempts"
      `);
      const typeFilter = input.types?.length
        ? Prisma.sql`AND "type" IN (${Prisma.join(input.types)})`
        : Prisma.empty;
      const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH candidate AS (
          SELECT "id"
          FROM "async_jobs"
          WHERE (
            ("status" = 'queued' AND "run_at" <= ${nowValue})
            OR ("status" = 'running' AND "lease_expires_at" <= ${nowValue})
          )
          AND "attempts" < "max_attempts"
          ${typeFilter}
          ORDER BY "run_at" ASC, "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "async_jobs" AS job
        SET
          "status" = 'running',
          "attempts" = job."attempts" + 1,
          "locked_by" = ${input.workerId},
          "locked_at" = ${nowValue},
          "lease_expires_at" = ${leaseExpiresAt},
          "updated_at" = ${nowValue}
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING job."id"
      `);
      if (!claimed[0]) {
        return undefined;
      }
      return mapPrismaJob(
        await prisma.asyncJob.findUniqueOrThrow({ where: { id: claimed[0].id } })
      );
    },
    async renewLease(input) {
      const result = await prisma.asyncJob.updateMany({
        where: { id: input.id, status: "running", lockedBy: input.workerId },
        data: { leaseExpiresAt: new Date(Date.now() + input.leaseMs) }
      });
      requireOwnedUpdate(result.count, input.id);
    },
    async complete(input) {
      const result = await prisma.asyncJob.updateMany({
        where: { id: input.id, status: "running", lockedBy: input.workerId },
        data: {
          status: "completed",
          result: jsonInput(input.result ?? {}),
          lockedBy: null,
          lockedAt: null,
          leaseExpiresAt: null,
          error: null
        }
      });
      requireOwnedUpdate(result.count, input.id);
    },
    async fail(input) {
      const existing = await prisma.asyncJob.findFirst({
        where: { id: input.id, status: "running", lockedBy: input.workerId }
      });
      if (!existing) {
        throw new Error(`Async job lease is not owned by this worker: ${input.id}`);
      }
      const shouldRetry = Boolean(input.retryAt) && existing.attempts < existing.maxAttempts;
      const result = await prisma.asyncJob.updateMany({
        where: { id: input.id, status: "running", lockedBy: input.workerId },
        data: {
          status: shouldRetry ? "queued" : "failed",
          runAt: shouldRetry && input.retryAt ? new Date(input.retryAt) : undefined,
          lockedBy: null,
          lockedAt: null,
          leaseExpiresAt: null,
          error: input.error
        }
      });
      requireOwnedUpdate(result.count, input.id);
    }
  };
}

export function createPrismaKnowledgeIndexStore(
  prisma: PrismaClient = createPrismaClient()
): KnowledgeIndexStore {
  return {
    async getDocument(input) {
      const document = await prisma.knowledgeDocument.findFirst({
        where: {
          id: input.documentId,
          projectId: input.projectId
        }
      });
      return document
        ? {
            id: document.id,
            projectId: document.projectId,
            title: document.title,
            sourceUri: document.sourceUri ?? undefined,
            content: document.content,
            metadata: jsonRecord(document.metadata)
          }
        : undefined;
    },
    async markIndexing(input) {
      await prisma.knowledgeDocument.update({
        where: { id: input.documentId },
        data: {
          status: "indexing",
          metadata: jsonInput(input.metadata),
          error: null
        }
      });
    },
    async replaceChunks(input) {
      await prisma.$transaction([
        prisma.knowledgeChunk.deleteMany({
          where: {
            projectId: input.projectId,
            documentId: input.documentId
          }
        }),
        prisma.knowledgeChunk.createMany({
          data: input.chunks.map((chunk) => ({
            id: chunk.id,
            projectId: input.projectId,
            documentId: input.documentId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            metadata: jsonInput(chunk.metadata)
          }))
        })
      ]);
    },
    async markIndexed(input) {
      await prisma.knowledgeDocument.update({
        where: { id: input.documentId },
        data: {
          status: "indexed",
          contentHash: input.contentHash,
          metadata: jsonInput(input.metadata),
          error: null
        }
      });
    },
    async markFailed(input) {
      await prisma.knowledgeDocument.update({
        where: { id: input.documentId },
        data: {
          status: "failed",
          metadata: jsonInput(input.metadata),
          error: input.error
        }
      });
    }
  };
}

function parseJobTypes(value: string | undefined): string[] {
  if (!value) {
    return [ANSWER_GENERATE_JOB_TYPE, "knowledge.index"];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateWorkerRuntimeConfig(config: WorkerRuntimeConfig): void {
  if (!config.workerId.trim()) {
    throw new Error("WORKER_ID must not be empty");
  }
  for (const [name, value] of [
    ["WORKER_POLL_INTERVAL_MS", config.pollIntervalMs],
    ["WORKER_RETRY_DELAY_MS", config.retryDelayMs],
    ["WORKER_LEASE_MS", config.leaseMs]
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (config.jobTypes.length === 0) {
    throw new Error("WORKER_JOB_TYPES must contain at least one implemented job type");
  }
}

function requiredPayloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Job payload field is required: ${key}`);
  }
  return value;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function mapPrismaJob(job: {
  id: string;
  type: string;
  status: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  leaseExpiresAt: Date | null;
}): WorkerJob {
  return {
    id: job.id,
    type: job.type,
    status: job.status as WorkerJobStatus,
    payload: jsonRecord(job.payload),
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    leaseExpiresAt: job.leaseExpiresAt?.toISOString()
  };
}

function requireOwnedUpdate(count: number, id: string): void {
  if (count !== 1) {
    throw new Error(`Async job lease is not owned by this worker: ${id}`);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (process.env["NODE_ENV"] !== "test" && process.env["WORKER_AUTOSTART"] !== "false") {
  const prisma = createPrismaClient();
  const runtime = createWorkerRuntime({
    queue: createPrismaWorkerQueue(prisma),
    handlers: createDefaultWorkerHandlers({
      knowledgeStore: createPrismaKnowledgeIndexStore(prisma),
      answerProcessor: createPrismaAnswerJobProcessor({ prisma })
    })
  });
  const controller = runtime.start();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await controller.stop();
    await prisma.$disconnect();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  console.log(`OpenSupportAI worker ready; job types: ${workerRuntimeConfig.jobTypes.join(", ")}`);
}
