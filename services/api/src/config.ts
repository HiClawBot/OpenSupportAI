import "dotenv/config";

export type StorageMode = "memory" | "prisma";
export type AnswerExecutionMode = "inline" | "worker";

export type ApiConfig = {
  nodeEnv: string;
  port: number;
  storageMode: StorageMode;
  answerExecutionMode: AnswerExecutionMode;
  adminToken: string;
  encryptionKey: string;
  clientTokenSecret: string;
  corsOrigin: string | true;
  rateLimitEnabled?: boolean;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  conversationTokenTtlSeconds: number;
  streamTokenTtlSeconds: number;
  sseHeartbeatMs: number;
  sseDatabasePollMs: number;
  allowPrivateOutbound: boolean;
  maxConcurrentAnswersPerProject: number;
  llmTimeoutMs: number;
  workerHeartbeatStaleMs: number;
  queueAgeDegradedMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = env["NODE_ENV"] ?? "development";
  const storageMode = parseStorageMode(env["OPENSUPPORTAI_STORAGE"], nodeEnv);
  const encryptionKey = env["ENCRYPTION_KEY"] ?? "replace_with_32_byte_key";
  const config: ApiConfig = {
    nodeEnv,
    port: Number(env["PORT"] ?? 4000),
    storageMode,
    answerExecutionMode: parseAnswerExecutionMode(env["ANSWER_EXECUTION_MODE"], storageMode),
    adminToken: env["ADMIN_API_TOKEN"] ?? "admin_demo_key",
    encryptionKey,
    clientTokenSecret: env["CLIENT_TOKEN_SECRET"] ?? "replace_with_32_byte_client_token_secret",
    corsOrigin: parseCorsOrigin(env["CORS_ORIGIN"]),
    rateLimitEnabled: parseBoolean(env["RATE_LIMIT_ENABLED"], nodeEnv !== "test"),
    rateLimitWindowMs: positiveInteger(env["RATE_LIMIT_WINDOW_MS"], 60_000),
    rateLimitMax: positiveInteger(env["RATE_LIMIT_MAX"], 120),
    conversationTokenTtlSeconds: positiveInteger(
      env["CONVERSATION_TOKEN_TTL_SECONDS"],
      7 * 24 * 60 * 60
    ),
    streamTokenTtlSeconds: positiveInteger(env["STREAM_TOKEN_TTL_SECONDS"], 60),
    sseHeartbeatMs: positiveInteger(env["SSE_HEARTBEAT_MS"], 15_000),
    sseDatabasePollMs: positiveInteger(env["SSE_DATABASE_POLL_MS"], 1_000),
    allowPrivateOutbound: parseBoolean(env["ALLOW_PRIVATE_OUTBOUND"], nodeEnv !== "production"),
    maxConcurrentAnswersPerProject: positiveInteger(env["MAX_CONCURRENT_ANSWERS_PER_PROJECT"], 4),
    llmTimeoutMs: positiveInteger(env["LLM_TIMEOUT_MS"], 45_000),
    workerHeartbeatStaleMs: positiveInteger(env["WORKER_HEARTBEAT_STALE_MS"], 30_000),
    queueAgeDegradedMs: positiveInteger(env["QUEUE_AGE_DEGRADED_MS"], 120_000)
  };

  validateConfig(config, env);
  return config;
}

export function validateConfig(config: ApiConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (config.streamTokenTtlSeconds > 300) {
    throw new Error("STREAM_TOKEN_TTL_SECONDS must not exceed 300 seconds");
  }

  if (config.nodeEnv !== "production") {
    return;
  }

  if (config.storageMode !== "prisma") {
    throw new Error("Production requires OPENSUPPORTAI_STORAGE=prisma");
  }
  if (config.answerExecutionMode !== "worker") {
    throw new Error("Production requires ANSWER_EXECUTION_MODE=worker");
  }
  if (!env["DATABASE_URL"]?.trim()) {
    throw new Error("Production requires DATABASE_URL");
  }
  assertProductionSecret(
    "ADMIN_API_TOKEN",
    config.adminToken,
    new Set(["admin_demo_key", "replace_me"])
  );
  assertProductionSecret(
    "ENCRYPTION_KEY",
    config.encryptionKey,
    new Set(["replace_with_32_byte_key", "replace_me"])
  );
  assertProductionSecret(
    "CLIENT_TOKEN_SECRET",
    config.clientTokenSecret,
    new Set(["replace_with_32_byte_client_token_secret", "replace_me"])
  );
  if (config.corsOrigin === true) {
    throw new Error("Production requires an explicit CORS_ORIGIN");
  }
  const corsUrl = parseHttpUrl(config.corsOrigin, "CORS_ORIGIN");
  if (corsUrl.origin !== config.corsOrigin.replace(/\/$/, "")) {
    throw new Error("CORS_ORIGIN must contain only a single origin");
  }
}

function parseStorageMode(value: string | undefined, nodeEnv: string | undefined): StorageMode {
  if (value === "memory" || value === "prisma") {
    return value;
  }

  return nodeEnv === "test" ? "memory" : "prisma";
}

function parseAnswerExecutionMode(
  value: string | undefined,
  storageMode: StorageMode
): AnswerExecutionMode {
  if (value === "inline" || value === "worker") {
    return value;
  }
  if (value !== undefined) {
    throw new Error("ANSWER_EXECUTION_MODE must be inline or worker");
  }
  return storageMode === "prisma" ? "worker" : "inline";
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

function parseCorsOrigin(value: string | undefined): string | true {
  const normalized = value?.trim();
  if (!normalized || normalized === "*" || normalized === "true") {
    return true;
  }
  return normalized.replace(/\/$/, "");
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function assertProductionSecret(name: string, value: string, forbidden: Set<string>): void {
  const normalized = value.toLowerCase();
  const looksLikePlaceholder =
    value.includes("<") ||
    value.includes(">") ||
    /replace|change[-_ ]?me|high[-_ ]?entropy/.test(normalized);
  if (
    value.length < 32 ||
    forbidden.has(value) ||
    new Set(value).size < 12 ||
    looksLikePlaceholder
  ) {
    throw new Error(`${name} must be an explicit high-entropy value of at least 32 characters`);
  }
}

function parseHttpUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use http or https`);
  }
  return url;
}
