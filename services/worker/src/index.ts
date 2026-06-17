export type WorkerRuntimeConfig = {
  queueName: string;
};

export const workerRuntimeConfig: WorkerRuntimeConfig = {
  queueName: "opensupportai"
};

if (process.env["NODE_ENV"] !== "test") {
  console.log(`OpenSupportAI worker listening on queue: ${workerRuntimeConfig.queueName}`);
  setInterval(() => {
    // PR-007+ worker jobs can attach here without changing the container contract.
  }, 60_000);
}
