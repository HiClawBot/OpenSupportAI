import { buildApp } from "./server";
import { loadConfig } from "./config";
import { createPrismaClient } from "./prisma-client";
import { PrismaSupportRepository } from "./repositories/prisma";
import { createPrismaRuntimeHealthStore, createRuntimeHealthProbe } from "./runtime-health";

export const apiService = {
  name: "@opensupportai/api",
  port: 4000
} as const;

export function health() {
  return {
    status: "ok",
    service: apiService.name
  };
}

if (process.env["NODE_ENV"] !== "test") {
  const config = loadConfig();
  const prisma = config.storageMode === "prisma" ? createPrismaClient() : undefined;
  const app = await buildApp({
    config,
    ...(prisma
      ? {
          repository: new PrismaSupportRepository(prisma),
          runtimeHealthProbe: createRuntimeHealthProbe(createPrismaRuntimeHealthStore(prisma), {
            workerStaleAfterMs: config.workerHeartbeatStaleMs,
            queueDegradedAfterMs: config.queueAgeDegradedMs
          })
        }
      : {})
  });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, "API shutdown started");
    await app.close();
    await prisma?.$disconnect();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
