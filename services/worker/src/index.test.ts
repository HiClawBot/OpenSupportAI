import { describe, expect, it } from "vitest";
import {
  createWorkerRuntime,
  workerRuntimeConfig,
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
});
