import { loadConfig } from "./config";
import { MemorySupportRepository } from "./repositories/memory";
import { buildApp } from "./server";

const config = loadConfig();
if (config.nodeEnv === "production") {
  throw new Error("The demo server cannot run with NODE_ENV=production");
}
if (config.storageMode !== "memory") {
  throw new Error("The demo server requires OPENSUPPORTAI_STORAGE=memory");
}

const repository = new MemorySupportRepository();
await repository.seedDemo();
const app = await buildApp({ config, repository });
await app.listen({ port: config.port, host: "0.0.0.0" });
