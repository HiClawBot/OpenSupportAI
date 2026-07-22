import { describe, expect, it } from "vitest";
import {
  createDefaultWorkerHandlers,
  createAnswerGenerateHandler,
  createKnowledgeIndexHandler,
  createWorkerRuntime,
  workerRuntimeConfig,
  type KnowledgeIndexDocument,
  type KnowledgeIndexStore,
  type WorkerJob,
  type WorkerJobQueue
} from "./index";

function createQueue(jobs: WorkerJob[]): WorkerJobQueue & {
  completed: Array<{ id: string; workerId: string; result?: Record<string, unknown> }>;
  failed: Array<{ id: string; workerId: string; error: string; retryAt?: string }>;
  renewed: Array<{ id: string; workerId: string; leaseMs: number }>;
  claimed: WorkerJob[];
} {
  const completed: Array<{ id: string; workerId: string; result?: Record<string, unknown> }> = [];
  const failed: Array<{ id: string; workerId: string; error: string; retryAt?: string }> = [];
  const renewed: Array<{ id: string; workerId: string; leaseMs: number }> = [];
  const claimed: WorkerJob[] = [];

  return {
    completed,
    failed,
    renewed,
    claimed,
    async claimNext() {
      const job = jobs.shift();
      if (job) {
        claimed.push(job);
      }
      return job;
    },
    async renewLease(input) {
      renewed.push(input);
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
  it("uses bounded default runtime settings", () => {
    expect(workerRuntimeConfig.leaseMs).toBe(60_000);
    expect(workerRuntimeConfig.jobTypes).toEqual(["answer.generate", "knowledge.index"]);
  });

  it("rejects invalid timing configuration", () => {
    expect(() =>
      createWorkerRuntime({
        queue: createQueue([]),
        handlers: { "knowledge.index": async () => ({}) },
        config: { leaseMs: 0 }
      })
    ).toThrow("WORKER_LEASE_MS must be a positive integer");
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
        workerId: "worker_test",
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
        type: "test.retryable",
        status: "running",
        payload: {},
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {
        "test.retryable": async () => {
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
        workerId: "worker_test",
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

  it("does not overlap runOnce calls", async () => {
    const handler = deferred<void>();
    const queue = createQueue([
      {
        id: "job_overlap",
        type: "knowledge.index",
        status: "running",
        payload: {},
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {
        "knowledge.index": async () => handler.promise
      },
      config: { workerId: "worker_test" }
    });

    const first = runtime.runOnce();
    await expect(runtime.runOnce()).resolves.toBe("busy");
    handler.resolve();
    await expect(first).resolves.toBe("processed");
    expect(queue.completed).toHaveLength(1);
  });

  it("renews the lease while a handler is running", async () => {
    const queue = createQueue([
      {
        id: "job_lease",
        type: "knowledge.index",
        status: "running",
        payload: {},
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: {
        "knowledge.index": async () => {
          await new Promise((resolve) => setTimeout(resolve, 130));
        }
      },
      config: { workerId: "worker_test", leaseMs: 300 }
    });

    await expect(runtime.runOnce()).resolves.toBe("processed");
    expect(queue.renewed).toContainEqual({
      id: "job_lease",
      workerId: "worker_test",
      leaseMs: 300
    });
  });

  it("drains the active job before stop resolves", async () => {
    const handler = deferred<void>();
    const queue = createQueue([
      {
        id: "job_drain",
        type: "knowledge.index",
        status: "running",
        payload: {},
        attempts: 1,
        maxAttempts: 3
      }
    ]);
    const runtime = createWorkerRuntime({
      queue,
      handlers: { "knowledge.index": async () => handler.promise },
      config: { workerId: "worker_test", pollIntervalMs: 5 }
    });
    const controller = runtime.start();
    await waitFor(() => queue.claimed.length === 1);
    const stopped = controller.stop();
    let stopResolved = false;
    void stopped.then(() => {
      stopResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopResolved).toBe(false);
    handler.resolve();
    await stopped;
    expect(queue.completed).toHaveLength(1);
  });

  it("registers only implemented default handlers", () => {
    const handlers = createDefaultWorkerHandlers({
      knowledgeStore: createKnowledgeStore([])
    });
    expect(Object.keys(handlers)).toEqual(["knowledge.index"]);
  });

  it("passes answer generation payloads to the shared processor", async () => {
    const payload = {
      project_id: "proj_1",
      conversation_id: "conv_1",
      message_id: "msg_1"
    };
    const handler = createAnswerGenerateHandler(async (received) => ({
      project_id: String(received["project_id"]),
      conversation_id: String(received["conversation_id"]),
      source_message_id: String(received["message_id"]),
      answer_message_id: "msg_answer",
      status: "completed"
    }));

    await expect(
      handler({
        id: "job_answer",
        type: "answer.generate",
        status: "running",
        payload,
        attempts: 1,
        maxAttempts: 3
      })
    ).resolves.toMatchObject({
      source_message_id: "msg_1",
      answer_message_id: "msg_answer"
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

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for worker state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
