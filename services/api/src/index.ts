import { buildApp } from "./server";
import { loadConfig } from "./config";

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
  const app = await buildApp({ config });
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
