CREATE TABLE "worker_heartbeats" (
  "worker_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "job_types" JSONB NOT NULL DEFAULT '[]',
  "current_job_id" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

CREATE INDEX "worker_heartbeats_status_last_seen_at_idx"
ON "worker_heartbeats"("status", "last_seen_at");
