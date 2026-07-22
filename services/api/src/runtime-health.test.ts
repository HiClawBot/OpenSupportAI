import { describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_DATABASE_MIGRATION,
  createRuntimeHealthProbe,
  type RuntimeHealthStore,
  type RuntimeQueueSummary,
  type RuntimeWorkerHeartbeat
} from "./runtime-health";

const now = new Date("2026-07-22T06:00:00.000Z");

function createStore(
  input: {
    migrationApplied?: boolean;
    heartbeats?: RuntimeWorkerHeartbeat[];
    queue?: Partial<RuntimeQueueSummary>;
    pingError?: Error;
  } = {}
): RuntimeHealthStore {
  return {
    async ping() {
      if (input.pingError) {
        throw input.pingError;
      }
    },
    async isMigrationApplied() {
      return input.migrationApplied ?? true;
    },
    async listWorkerHeartbeats() {
      return input.heartbeats ?? [];
    },
    async getQueueSummary() {
      return {
        queued: 0,
        running: 0,
        failed: 0,
        completed: 0,
        cancelled: 0,
        ...input.queue
      };
    }
  };
}

function heartbeat(
  input: {
    lastSeenAt?: Date;
    jobTypes?: string[];
    status?: string;
  } = {}
): RuntimeWorkerHeartbeat {
  return {
    workerId: "worker-1",
    status: input.status ?? "ready",
    jobTypes: input.jobTypes ?? ["answer.generate", "knowledge.index"],
    startedAt: new Date(now.getTime() - 60_000),
    lastSeenAt: input.lastSeenAt ?? new Date(now.getTime() - 1_000)
  };
}

function probe(store: RuntimeHealthStore) {
  return createRuntimeHealthProbe(store, {
    workerStaleAfterMs: 10_000,
    queueDegradedAfterMs: 30_000,
    now: () => now
  });
}

describe("runtime health", () => {
  it("tracks the repository migration head", async () => {
    const migrationDirectory = fileURLToPath(
      new URL("../../../prisma/migrations", import.meta.url)
    );
    const migrations = (await readdir(migrationDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(EXPECTED_DATABASE_MIGRATION).toBe(migrations.at(-1));
  });

  it("is ready only with the expected migration and a complete current worker", async () => {
    const snapshot = await probe(createStore({ heartbeats: [heartbeat()] }))();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.checks.migration.status).toBe("ok");
    expect(snapshot.checks.worker).toMatchObject({ status: "ok", active_count: 1 });
  });

  it("reports database and migration blockers without exposing raw errors", async () => {
    const database = await probe(createStore({ pingError: new Error("secret host name") }))();
    const migration = await probe(createStore({ migrationApplied: false }))();

    expect(database).toMatchObject({
      status: "not_ready",
      reasons: ["database_unavailable"],
      checks: { database: { status: "error" } }
    });
    expect(JSON.stringify(database)).not.toContain("secret host name");
    expect(migration).toMatchObject({
      status: "not_ready",
      reasons: ["migration_pending"],
      checks: { migration: { status: "pending" } }
    });
  });

  it("rejects stale and incomplete workers", async () => {
    const stale = await probe(
      createStore({ heartbeats: [heartbeat({ lastSeenAt: new Date(now.getTime() - 20_000) })] })
    )();
    const incomplete = await probe(
      createStore({ heartbeats: [heartbeat({ jobTypes: ["knowledge.index"] })] })
    )();

    expect(stale).toMatchObject({ status: "not_ready", reasons: ["worker_stale"] });
    expect(incomplete).toMatchObject({ status: "not_ready", reasons: ["worker_incomplete"] });
  });

  it("marks queue age degraded without making the API unready", async () => {
    const snapshot = await probe(
      createStore({
        heartbeats: [heartbeat()],
        queue: {
          queued: 3,
          oldestQueuedAt: new Date(now.getTime() - 31_000)
        }
      })
    )();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.checks.queue).toMatchObject({
      status: "degraded",
      queued: 3,
      oldest_queued_age_seconds: 31
    });
  });
});
