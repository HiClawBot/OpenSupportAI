import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { indexTextDocument } from "@opensupportai/rag";

export type WorkerJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type WorkerJob = {
  id: string;
  type: string;
  status: WorkerJobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

export type WorkerJobQueue = {
  claimNext(input: { workerId: string; types?: string[] }): Promise<WorkerJob | undefined>;
  complete(input: { id: string; result?: Record<string, unknown> }): Promise<void>;
  fail(input: { id: string; error: string; retryAt?: string }): Promise<void>;
};

export type WorkerJobHandler = (job: WorkerJob) => Promise<Record<string, unknown> | void>;

export type WorkerRuntimeConfig = {
  queueName: string;
  workerId: string;
  pollIntervalMs: number;
  retryDelayMs: number;
  jobTypes: string[];
};

export type WorkerRuntime = {
  runOnce(): Promise<"processed" | "idle">;
  start(): { stop(): void };
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
  queueName: process.env["WORKER_QUEUE_NAME"] ?? "opensupportai",
  workerId: process.env["WORKER_ID"] ?? `worker_${Math.random().toString(16).slice(2)}`,
  pollIntervalMs: Number(process.env["WORKER_POLL_INTERVAL_MS"] ?? 5_000),
  retryDelayMs: Number(process.env["WORKER_RETRY_DELAY_MS"] ?? 30_000),
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
  const now = input.now ?? (() => new Date());

  return {
    async runOnce() {
      const job = await input.queue.claimNext({
        workerId: config.workerId,
        types: config.jobTypes
      });
      if (!job) {
        return "idle";
      }

      const handler = input.handlers[job.type];
      if (!handler) {
        await input.queue.fail({
          id: job.id,
          error: `No handler registered for job type: ${job.type}`
        });
        return "processed";
      }

      try {
        const result = await handler(job);
        await input.queue.complete({
          id: job.id,
          result: result ?? {}
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown worker error";
        await input.queue.fail({
          id: job.id,
          error: message,
          retryAt:
            job.attempts < job.maxAttempts
              ? new Date(now().getTime() + config.retryDelayMs).toISOString()
              : undefined
        });
      }

      return "processed";
    },
    start() {
      const timer = setInterval(() => {
        void this.runOnce().catch((error) => {
          console.error(error instanceof Error ? error.message : "Worker run failed");
        });
      }, config.pollIntervalMs);

      return {
        stop() {
          clearInterval(timer);
        }
      };
    }
  };
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

export function createDefaultWorkerHandlers(input: {
  knowledgeStore: KnowledgeIndexStore;
}): Record<string, WorkerJobHandler> {
  return {
    "knowledge.index": createKnowledgeIndexHandler(input.knowledgeStore),
    "webhook.retry": async (job) => ({
      skipped: true,
      job_type: job.type,
      reason: "webhook.retry handler is not implemented yet"
    })
  };
}

export function createPrismaWorkerQueue(prisma: PrismaClient = new PrismaClient()): WorkerJobQueue {
  return {
    async claimNext(input) {
      const job = await prisma.asyncJob.findFirst({
        where: {
          status: "queued",
          runAt: { lte: new Date() },
          ...(input.types?.length ? { type: { in: input.types } } : {})
        },
        orderBy: [{ runAt: "asc" }, { createdAt: "asc" }]
      });
      if (!job) {
        return undefined;
      }
      const updated = await prisma.asyncJob.update({
        where: { id: job.id },
        data: {
          status: "running",
          attempts: { increment: 1 },
          lockedBy: input.workerId,
          lockedAt: new Date()
        }
      });
      return mapPrismaJob(updated);
    },
    async complete(input) {
      await prisma.asyncJob.update({
        where: { id: input.id },
        data: {
          status: "completed",
          result: jsonInput(input.result ?? {}),
          lockedBy: null,
          lockedAt: null,
          error: null
        }
      });
    },
    async fail(input) {
      await prisma.asyncJob.update({
        where: { id: input.id },
        data: {
          status: input.retryAt ? "queued" : "failed",
          runAt: input.retryAt ? new Date(input.retryAt) : undefined,
          lockedBy: null,
          lockedAt: null,
          error: input.error
        }
      });
    }
  };
}

export function createPrismaKnowledgeIndexStore(
  prisma: PrismaClient = new PrismaClient()
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
    return ["knowledge.index", "webhook.retry"];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
}): WorkerJob {
  return {
    id: job.id,
    type: job.type,
    status: job.status as WorkerJobStatus,
    payload: jsonRecord(job.payload),
    attempts: job.attempts,
    maxAttempts: job.maxAttempts
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (process.env["NODE_ENV"] !== "test") {
  const prisma = new PrismaClient();
  const runtime = createWorkerRuntime({
    queue: createPrismaWorkerQueue(prisma),
    handlers: createDefaultWorkerHandlers({
      knowledgeStore: createPrismaKnowledgeIndexStore(prisma)
    })
  });
  if (process.env["WORKER_AUTOSTART"] !== "false") {
    runtime.start();
  }
  console.log(
    `OpenSupportAI worker ready for queue ${workerRuntimeConfig.queueName}; job types: ${workerRuntimeConfig.jobTypes.join(", ")}`
  );
}
