import type { PrismaClient } from "@prisma/client";

export const EXPECTED_DATABASE_MIGRATION = "202607220005_lexical_retrieval";
export const REQUIRED_WORKER_JOB_TYPES = ["answer.generate", "knowledge.index"] as const;

export type RuntimeWorkerHeartbeat = {
  workerId: string;
  status: string;
  jobTypes: string[];
  currentJobId?: string;
  startedAt: Date;
  lastSeenAt: Date;
};

export type RuntimeQueueSummary = {
  queued: number;
  running: number;
  failed: number;
  completed: number;
  cancelled: number;
  oldestQueuedAt?: Date;
};

export type RuntimeHealthStore = {
  ping(): Promise<void>;
  isMigrationApplied(migrationName: string): Promise<boolean>;
  listWorkerHeartbeats(): Promise<RuntimeWorkerHeartbeat[]>;
  getQueueSummary(now: Date): Promise<RuntimeQueueSummary>;
};

export type RuntimeHealthSnapshot = {
  status: "ready" | "not_ready";
  generated_at: string;
  reasons: string[];
  checks: {
    database: {
      status: "ok" | "error";
      latency_ms: number;
    };
    migration: {
      status: "ok" | "pending" | "unknown";
      expected: string;
    };
    worker: {
      status: "ok" | "missing" | "stale" | "incomplete" | "unknown" | "not_required";
      active_count: number;
      stale_count: number;
      required_job_types: string[];
      latest_seen_at?: string;
    };
    queue: {
      status: "ok" | "degraded" | "unknown";
      queued: number;
      running: number;
      failed: number;
      completed: number;
      cancelled: number;
      oldest_queued_age_seconds?: number;
    };
  };
};

export type RuntimeHealthProbe = () => Promise<RuntimeHealthSnapshot>;

export function createRuntimeHealthProbe(
  store: RuntimeHealthStore,
  options: {
    workerStaleAfterMs: number;
    queueDegradedAfterMs: number;
    requiredWorkerJobTypes?: readonly string[];
    expectedMigration?: string;
    now?: () => Date;
  }
): RuntimeHealthProbe {
  const requiredWorkerJobTypes = [...(options.requiredWorkerJobTypes ?? REQUIRED_WORKER_JOB_TYPES)];
  const expectedMigration = options.expectedMigration ?? EXPECTED_DATABASE_MIGRATION;
  const now = options.now ?? (() => new Date());

  return async () => {
    const checkedAt = now();
    const pingStartedAt = performance.now();
    try {
      await store.ping();
    } catch {
      return unavailableSnapshot({
        checkedAt,
        expectedMigration,
        requiredWorkerJobTypes,
        databaseLatencyMs: elapsedMilliseconds(pingStartedAt),
        reason: "database_unavailable"
      });
    }
    const databaseLatencyMs = elapsedMilliseconds(pingStartedAt);

    let migrationApplied: boolean;
    try {
      migrationApplied = await store.isMigrationApplied(expectedMigration);
    } catch {
      return unavailableSnapshot({
        checkedAt,
        expectedMigration,
        requiredWorkerJobTypes,
        databaseLatencyMs,
        reason: "migration_state_unavailable",
        databaseStatus: "ok"
      });
    }
    if (!migrationApplied) {
      return unavailableSnapshot({
        checkedAt,
        expectedMigration,
        requiredWorkerJobTypes,
        databaseLatencyMs,
        reason: "migration_pending",
        databaseStatus: "ok",
        migrationStatus: "pending"
      });
    }

    let heartbeats: RuntimeWorkerHeartbeat[];
    let queue: RuntimeQueueSummary;
    try {
      [heartbeats, queue] = await Promise.all([
        store.listWorkerHeartbeats(),
        store.getQueueSummary(checkedAt)
      ]);
    } catch {
      return unavailableSnapshot({
        checkedAt,
        expectedMigration,
        requiredWorkerJobTypes,
        databaseLatencyMs,
        reason: "runtime_state_unavailable",
        databaseStatus: "ok",
        migrationStatus: "ok"
      });
    }

    const cutoff = checkedAt.getTime() - options.workerStaleAfterMs;
    const readyHeartbeats = heartbeats.filter(
      (heartbeat) => heartbeat.status === "ready" && heartbeat.lastSeenAt.getTime() >= cutoff
    );
    const staleHeartbeats = heartbeats.filter(
      (heartbeat) => heartbeat.status === "ready" && heartbeat.lastSeenAt.getTime() < cutoff
    );
    const completeHeartbeats = readyHeartbeats.filter((heartbeat) =>
      requiredWorkerJobTypes.every((jobType) => heartbeat.jobTypes.includes(jobType))
    );
    const latestSeenAt = heartbeats.reduce<Date | undefined>(
      (latest, heartbeat) =>
        !latest || heartbeat.lastSeenAt > latest ? heartbeat.lastSeenAt : latest,
      undefined
    );
    const workerStatus = workerCheckStatus({
      heartbeatCount: heartbeats.length,
      readyCount: readyHeartbeats.length,
      completeCount: completeHeartbeats.length
    });
    const reasons = workerStatus === "ok" ? [] : [`worker_${workerStatus}`];
    const oldestQueuedAgeMs = queue.oldestQueuedAt
      ? Math.max(0, checkedAt.getTime() - queue.oldestQueuedAt.getTime())
      : undefined;

    return {
      status: reasons.length === 0 ? "ready" : "not_ready",
      generated_at: checkedAt.toISOString(),
      reasons,
      checks: {
        database: {
          status: "ok",
          latency_ms: databaseLatencyMs
        },
        migration: {
          status: "ok",
          expected: expectedMigration
        },
        worker: {
          status: workerStatus,
          active_count: completeHeartbeats.length,
          stale_count: staleHeartbeats.length,
          required_job_types: requiredWorkerJobTypes,
          ...(latestSeenAt ? { latest_seen_at: latestSeenAt.toISOString() } : {})
        },
        queue: {
          status:
            oldestQueuedAgeMs !== undefined && oldestQueuedAgeMs > options.queueDegradedAfterMs
              ? "degraded"
              : "ok",
          queued: queue.queued,
          running: queue.running,
          failed: queue.failed,
          completed: queue.completed,
          cancelled: queue.cancelled,
          ...(oldestQueuedAgeMs !== undefined
            ? { oldest_queued_age_seconds: Math.floor(oldestQueuedAgeMs / 1_000) }
            : {})
        }
      }
    } satisfies RuntimeHealthSnapshot;
  };
}

export function createMemoryRuntimeHealthProbe(
  now: () => Date = () => new Date()
): RuntimeHealthProbe {
  return async () => ({
    status: "ready",
    generated_at: now().toISOString(),
    reasons: [],
    checks: {
      database: { status: "ok", latency_ms: 0 },
      migration: { status: "ok", expected: "not_required" },
      worker: {
        status: "not_required",
        active_count: 0,
        stale_count: 0,
        required_job_types: []
      },
      queue: {
        status: "ok",
        queued: 0,
        running: 0,
        failed: 0,
        completed: 0,
        cancelled: 0
      }
    }
  });
}

export function createUnavailableRuntimeHealthProbe(
  reason = "runtime_health_probe_missing",
  now: () => Date = () => new Date()
): RuntimeHealthProbe {
  return async () =>
    unavailableSnapshot({
      checkedAt: now(),
      expectedMigration: EXPECTED_DATABASE_MIGRATION,
      requiredWorkerJobTypes: [...REQUIRED_WORKER_JOB_TYPES],
      databaseLatencyMs: 0,
      reason
    });
}

export function createPrismaRuntimeHealthStore(prisma: PrismaClient): RuntimeHealthStore {
  return {
    async ping() {
      await prisma.$queryRaw`SELECT 1`;
    },
    async isMigrationApplied(migrationName) {
      const rows = await prisma.$queryRaw<Array<{ applied: number }>>`
        SELECT COUNT(*)::INTEGER AS "applied"
        FROM "_prisma_migrations"
        WHERE
          "migration_name" = ${migrationName}
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      `;
      return rows[0]?.applied === 1;
    },
    async listWorkerHeartbeats() {
      const heartbeats = await prisma.workerHeartbeat.findMany({
        orderBy: { lastSeenAt: "desc" },
        take: 100
      });
      return heartbeats.map((heartbeat) => ({
        workerId: heartbeat.workerId,
        status: heartbeat.status,
        jobTypes: stringArray(heartbeat.jobTypes),
        ...(heartbeat.currentJobId ? { currentJobId: heartbeat.currentJobId } : {}),
        startedAt: heartbeat.startedAt,
        lastSeenAt: heartbeat.lastSeenAt
      }));
    },
    async getQueueSummary(now) {
      const [counts, oldestQueued] = await Promise.all([
        prisma.asyncJob.groupBy({
          by: ["status"],
          _count: { _all: true }
        }),
        prisma.asyncJob.findFirst({
          where: {
            status: "queued",
            runAt: { lte: now }
          },
          orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
          select: { runAt: true }
        })
      ]);
      const countFor = (status: string) =>
        counts.find((entry) => entry.status === status)?._count._all ?? 0;
      return {
        queued: countFor("queued"),
        running: countFor("running"),
        failed: countFor("failed"),
        completed: countFor("completed"),
        cancelled: countFor("cancelled"),
        ...(oldestQueued ? { oldestQueuedAt: oldestQueued.runAt } : {})
      };
    }
  };
}

function unavailableSnapshot(input: {
  checkedAt: Date;
  expectedMigration: string;
  requiredWorkerJobTypes: string[];
  databaseLatencyMs: number;
  reason: string;
  databaseStatus?: "ok" | "error";
  migrationStatus?: "ok" | "pending" | "unknown";
}): RuntimeHealthSnapshot {
  return {
    status: "not_ready",
    generated_at: input.checkedAt.toISOString(),
    reasons: [input.reason],
    checks: {
      database: {
        status: input.databaseStatus ?? "error",
        latency_ms: input.databaseLatencyMs
      },
      migration: {
        status: input.migrationStatus ?? "unknown",
        expected: input.expectedMigration
      },
      worker: {
        status: "unknown",
        active_count: 0,
        stale_count: 0,
        required_job_types: input.requiredWorkerJobTypes
      },
      queue: {
        status: "unknown",
        queued: 0,
        running: 0,
        failed: 0,
        completed: 0,
        cancelled: 0
      }
    }
  };
}

function workerCheckStatus(input: {
  heartbeatCount: number;
  readyCount: number;
  completeCount: number;
}): "ok" | "missing" | "stale" | "incomplete" {
  if (input.completeCount > 0) {
    return "ok";
  }
  if (input.heartbeatCount === 0) {
    return "missing";
  }
  if (input.readyCount === 0) {
    return "stale";
  }
  return "incomplete";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}
