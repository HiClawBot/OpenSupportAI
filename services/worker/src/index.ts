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
        void this.runOnce();
      }, config.pollIntervalMs);

      return {
        stop() {
          clearInterval(timer);
        }
      };
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

if (process.env["NODE_ENV"] !== "test") {
  console.log(
    `OpenSupportAI worker ready for queue ${workerRuntimeConfig.queueName}; job types: ${workerRuntimeConfig.jobTypes.join(", ")}`
  );
}
