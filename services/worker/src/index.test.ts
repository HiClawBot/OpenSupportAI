import { describe, expect, it } from "vitest";
import {
  createKnowledgeIndexHandler,
  createWorkerRuntime,
  workerRuntimeConfig,
  type KnowledgeIndexDocument,
  type KnowledgeIndexStore,
  type WorkerJob,
  type WorkerJobQueue
} from "./index";

function createQueue(jobs: WorkerJob[]): WorkerJobQueue & {
  completed: Array<{ id: string; result?: Record<string, unknown> }>;
  failed: Array<{ id: string; error: string; retryAt?: string }>;
} {
  const completed: Array<{ id: string; result?: Record<string, unknown> }> = [];
  const failed: Array<{ id: string; error: string; retryAt?: string }> = [];

  return {
    completed,
    failed,
    async claimNext() {
      return jobs.shift();
    },
    async complete(input) {
      completed.push(input);
    },
    async fail(input) {
      failed.push(input);
    }
  };
}

describe("worker runtime", () => {
  it("uses the default queue name", () => {
    expect(workerRuntimeConfig.queueName).toBe("opensupportai");
  });

  it("processes a claimed job with its handler", async () => {
    const queue = createQueue([
      {
        id: "job_1",
        type: "knowledge.index",
        status: "running",
        payload: { document_id: "doc_1" },
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {
        "knowledge.index": async (job) => ({ indexed_document_id: job.payload["document_id"] })
      },
      config: {
        workerId: "worker_test",
        retryDelayMs: 1000
      }
    });

    await expect(runtime.runOnce()).resolves.toBe("processed");
    expect(queue.completed).toEqual([
      {
        id: "job_1",
        result: {
          indexed_document_id: "doc_1"
        }
      }
    ]);
    expect(queue.failed).toEqual([]);
  });

  it("schedules a retry when a handler fails before max attempts", async () => {
    const queue = createQueue([
      {
        id: "job_2",
        type: "webhook.retry",
        status: "running",
        payload: {},
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {
        "webhook.retry": async () => {
          throw new Error("temporary failure");
        }
      },
      config: {
        workerId: "worker_test",
        retryDelayMs: 1000
      },
      now: () => new Date("2026-06-18T00:00:00.000Z")
    });

    await expect(runtime.runOnce()).resolves.toBe("processed");
    expect(queue.failed).toEqual([
      {
        id: "job_2",
        error: "temporary failure",
        retryAt: "2026-06-18T00:00:01.000Z"
      }
    ]);
  });

  it("fails unsupported job types without retrying", async () => {
    const queue = createQueue([
      {
        id: "job_3",
        type: "unknown.job",
        status: "running",
        payload: {},
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {},
      config: {
        workerId: "worker_test",
        jobTypes: ["unknown.job"]
      }
    });

    await expect(runtime.runOnce()).resolves.toBe("processed");
    expect(queue.failed[0]).toMatchObject({
      id: "job_3",
      error: "No handler registered for job type: unknown.job"
    });
  });

  it("indexes knowledge document jobs by rebuilding chunks", async () => {
    const document: KnowledgeIndexDocument = {
      id: "doc_1",
      projectId: "proj_1",
      title: "Billing FAQ",
      sourceUri: "https://example.test/billing",
      content: "Cancel from billing settings.\n\nRefunds require manual review.",
      metadata: { locale: "en" }
    };
    const store = createKnowledgeStore([document]);
    const queue = createQueue([
      {
        id: "job_4",
        type: "knowledge.index",
        status: "running",
        payload: { project_id: "proj_1", document_id: "doc_1" },
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {
        "knowledge.index": createKnowledgeIndexHandler(store)
      },
      config: {
        workerId: "worker_test"
      }
    });

    await expect(runtime.runOnce()).resolves.toBe("processed");
    expect(store.states).toEqual(["indexing", "indexed"]);
    expect(store.chunks).toHaveLength(1);
    expect(store.chunks[0]?.metadata).toMatchObject({
      title: "Billing FAQ",
      source_uri: "https://example.test/billing"
    });
    expect(queue.completed[0]?.result).toMatchObject({
      indexed_document_id: "doc_1",
      chunk_count: 1
    });
  });

  it("marks empty knowledge documents as failed", async () => {
    const document: KnowledgeIndexDocument = {
      id: "doc_empty",
      projectId: "proj_1",
      title: "Empty FAQ",
      content: " ",
      metadata: {}
    };
    const store = createKnowledgeStore([document]);
    const queue = createQueue([
      {
        id: "job_5",
        type: "knowledge.index",
        status: "running",
        payload: { project_id: "proj_1", document_id: "doc_empty" },
        attempts: 1,
        maxAttempts: 1
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {
        "knowledge.index": createKnowledgeIndexHandler(store)
      },
      config: {
        workerId: "worker_test"
      }
    });

    await expect(runtime.runOnce()).resolves.toBe("processed");
    expect(store.states).toEqual(["indexing", "failed"]);
    expect(queue.failed[0]).toMatchObject({
      id: "job_5",
      error: "Knowledge document content is empty"
    });
  });
});

function createKnowledgeStore(documents: KnowledgeIndexDocument[]): KnowledgeIndexStore & {
  chunks: Array<{ content: string; metadata: Record<string, unknown> }>;
  states: string[];
} {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const chunks: Array<{ content: string; metadata: Record<string, unknown> }> = [];
  const states: string[] = [];

  return {
    chunks,
    states,
    async getDocument(input) {
      const document = documentsById.get(input.documentId);
      return document?.projectId === input.projectId ? document : undefined;
    },
    async markIndexing() {
      states.push("indexing");
    },
    async replaceChunks(input) {
      chunks.splice(0, chunks.length, ...input.chunks);
    },
    async markIndexed() {
      states.push("indexed");
    },
    async markFailed() {
      states.push("failed");
    }
  };
}
