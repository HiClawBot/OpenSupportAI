import "dotenv/config";

export type StorageMode = "memory" | "prisma";

export type ApiConfig = {
  nodeEnv: string;
  port: number;
  storageMode: StorageMode;
  adminToken: string;
  encryptionKey: string;
  corsOrigin: string | true;
  rateLimitEnabled?: boolean;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const storageMode = parseStorageMode(env["OPENSUPPORTAI_STORAGE"], env["NODE_ENV"]);

  return {
    nodeEnv: env["NODE_ENV"] ?? "development",
    port: Number(env["PORT"] ?? 4000),
    storageMode,
    adminToken: env["ADMIN_API_TOKEN"] ?? "admin_demo_key",
    encryptionKey: env["ENCRYPTION_KEY"] ?? "replace_with_32_byte_key",
    corsOrigin: env["CORS_ORIGIN"] ?? true,
    rateLimitEnabled: parseBoolean(env["RATE_LIMIT_ENABLED"], env["NODE_ENV"] !== "test"),
    rateLimitWindowMs: Number(env["RATE_LIMIT_WINDOW_MS"] ?? 60_000),
    rateLimitMax: Number(env["RATE_LIMIT_MAX"] ?? 120)
  };
}

function parseStorageMode(value: string | undefined, nodeEnv: string | undefined): StorageMode {
  if (value === "memory" || value === "prisma") {
    return value;
  }

  return nodeEnv === "test" ? "memory" : "prisma";
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return fallback;
}
