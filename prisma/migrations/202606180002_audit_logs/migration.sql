CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "organization_id" TEXT,
  "actor_type" TEXT NOT NULL,
  "actor_id" TEXT,
  "action" TEXT NOT NULL,
  "target_type" TEXT,
  "target_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "request_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_project_id_created_at_idx" ON "audit_logs"("project_id", "created_at");
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
