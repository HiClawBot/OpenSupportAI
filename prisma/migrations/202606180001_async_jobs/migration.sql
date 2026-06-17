CREATE TABLE "async_jobs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "result" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_by" TEXT,
  "locked_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "async_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "async_jobs_project_id_status_idx" ON "async_jobs"("project_id", "status");
CREATE INDEX "async_jobs_status_run_at_idx" ON "async_jobs"("status", "run_at");
CREATE INDEX "async_jobs_type_status_idx" ON "async_jobs"("type", "status");

ALTER TABLE "async_jobs"
  ADD CONSTRAINT "async_jobs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
