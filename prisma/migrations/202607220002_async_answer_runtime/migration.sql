ALTER TABLE "async_jobs"
ADD COLUMN "deduplication_key" TEXT;

CREATE UNIQUE INDEX "async_jobs_project_id_type_deduplication_key_key"
ON "async_jobs"("project_id", "type", "deduplication_key");
