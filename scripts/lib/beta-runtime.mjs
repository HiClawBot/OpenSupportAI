import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class RuntimeProbeRequestError extends Error {
  constructor(method, url, status, body) {
    super(`${method} ${url} failed with HTTP ${status}: ${body}`);
    this.name = "RuntimeProbeRequestError";
    this.status = status;
  }
}

export function runtimeSettings(env = process.env) {
  return {
    apiUrl: (env["API_URL"] ?? "http://127.0.0.1:4000").replace(/\/$/, ""),
    adminToken: requiredEnvironment(env, "ADMIN_TOKEN", env["ADMIN_API_TOKEN"]),
    projectId: env["PROJECT_ID"] ?? "proj_demo",
    publicKey: env["PUBLIC_KEY"] ?? "pk_demo",
    inboxId: env["INBOX_ID"] ?? "inbox_default"
  };
}

export async function requestJson(
  settings,
  method,
  path,
  { body, headers = {}, expectedStatuses = [200], timeoutMs = 15_000 } = {}
) {
  const url = `${settings.apiUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!expectedStatuses.includes(response.status)) {
      throw new RuntimeProbeRequestError(method, url, response.status, text);
    }
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`${method} ${url} returned non-JSON content`);
      }
    }
    return {
      status: response.status,
      payload,
      durationMs: performance.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

export function projectHeaders(settings, additional = {}) {
  return {
    "x-opensupportai-public-key": settings.publicKey,
    ...additional
  };
}

export function conversationHeaders(token, additional = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...additional
  };
}

export function adminHeaders(settings, additional = {}) {
  return {
    Authorization: `Bearer ${settings.adminToken}`,
    ...additional
  };
}

export function uniqueRunId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function integerEnvironment(env, name, fallback, minimum = 1) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

export function booleanEnvironment(env, name, fallback) {
  const value = env[name];
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true/false or 1/0`);
}

export function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1);
  return round(ordered[index] ?? 0);
}

export function latencySummary(values) {
  return {
    samples: values.length,
    min_ms: values.length === 0 ? 0 : round(Math.min(...values)),
    p50_ms: percentile(values, 50),
    p95_ms: percentile(values, 95),
    max_ms: values.length === 0 ? 0 : round(Math.max(...values))
  };
}

export async function waitFor(check, { timeoutMs, intervalMs = 500, description }) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      lastValue = await check();
      if (lastValue) return lastValue;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

export async function runWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

function requiredEnvironment(env, primaryName, fallback) {
  const value = env[primaryName] ?? fallback;
  if (!value?.trim()) {
    throw new Error(`${primaryName} or ADMIN_API_TOKEN is required`);
  }
  return value;
}
