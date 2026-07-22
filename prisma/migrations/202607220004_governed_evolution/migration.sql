CREATE TABLE "evaluation_suites" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "evaluator_version" TEXT NOT NULL,
  "thresholds" JSONB NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "evaluation_suites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_scenarios" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "critical" BOOLEAN NOT NULL DEFAULT false,
  "input" JSONB NOT NULL,
  "expectations" JSONB NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "evaluation_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_runs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "suite_version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "evaluator_version" TEXT NOT NULL,
  "thresholds" JSONB NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "pass_rate" DOUBLE PRECISION NOT NULL,
  "passed_count" INTEGER NOT NULL,
  "failed_count" INTEGER NOT NULL,
  "critical_failures" JSONB NOT NULL DEFAULT '[]',
  "summary" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_results" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "scenario_id" TEXT,
  "scenario_slug" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "critical" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "outcome" TEXT NOT NULL,
  "assertions" JSONB NOT NULL,
  "observed" JSONB NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "evaluation_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evolution_proposals" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "source_run_id" TEXT NOT NULL,
  "regression_run_id" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "title" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "artifact" JSONB NOT NULL,
  "artifact_hash" TEXT NOT NULL,
  "baseline" JSONB NOT NULL DEFAULT '{}',
  "canary_evidence" JSONB,
  "rollback_target" JSONB,
  "review_note" TEXT,
  "created_by" TEXT,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "promoted_at" TIMESTAMP(3),
  "rolled_back_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "evolution_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evaluation_suites_id_project_id_key" ON "evaluation_suites"("id", "project_id");
CREATE UNIQUE INDEX "evaluation_suites_project_id_slug_version_key" ON "evaluation_suites"("project_id", "slug", "version");
CREATE INDEX "evaluation_suites_project_id_status_created_at_idx" ON "evaluation_suites"("project_id", "status", "created_at");
CREATE UNIQUE INDEX "evaluation_scenarios_id_project_id_key" ON "evaluation_scenarios"("id", "project_id");
CREATE UNIQUE INDEX "evaluation_scenarios_suite_id_slug_key" ON "evaluation_scenarios"("suite_id", "slug");
CREATE INDEX "evaluation_scenarios_project_id_category_idx" ON "evaluation_scenarios"("project_id", "category");
CREATE UNIQUE INDEX "evaluation_runs_id_project_id_key" ON "evaluation_runs"("id", "project_id");
CREATE INDEX "evaluation_runs_project_id_status_created_at_idx" ON "evaluation_runs"("project_id", "status", "created_at");
CREATE INDEX "evaluation_runs_suite_id_created_at_idx" ON "evaluation_runs"("suite_id", "created_at");
CREATE UNIQUE INDEX "evaluation_results_run_id_scenario_slug_key" ON "evaluation_results"("run_id", "scenario_slug");
CREATE INDEX "evaluation_results_project_id_status_created_at_idx" ON "evaluation_results"("project_id", "status", "created_at");
CREATE INDEX "evaluation_results_scenario_id_idx" ON "evaluation_results"("scenario_id");
CREATE UNIQUE INDEX "evolution_proposals_id_project_id_key" ON "evolution_proposals"("id", "project_id");
CREATE INDEX "evolution_proposals_project_id_status_created_at_idx" ON "evolution_proposals"("project_id", "status", "created_at");
CREATE INDEX "evolution_proposals_source_run_id_idx" ON "evolution_proposals"("source_run_id");
CREATE INDEX "evolution_proposals_regression_run_id_idx" ON "evolution_proposals"("regression_run_id");

ALTER TABLE "evaluation_suites" ADD CONSTRAINT "evaluation_suites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_scenarios" ADD CONSTRAINT "evaluation_scenarios_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_scenarios" ADD CONSTRAINT "evaluation_scenarios_suite_id_project_id_fkey" FOREIGN KEY ("suite_id", "project_id") REFERENCES "evaluation_suites"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_suite_id_project_id_fkey" FOREIGN KEY ("suite_id", "project_id") REFERENCES "evaluation_suites"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_run_id_project_id_fkey" FOREIGN KEY ("run_id", "project_id") REFERENCES "evaluation_runs"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_scenario_id_project_id_fkey" FOREIGN KEY ("scenario_id", "project_id") REFERENCES "evaluation_scenarios"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evolution_proposals" ADD CONSTRAINT "evolution_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evolution_proposals" ADD CONSTRAINT "evolution_proposals_source_run_id_project_id_fkey" FOREIGN KEY ("source_run_id", "project_id") REFERENCES "evaluation_runs"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evolution_proposals" ADD CONSTRAINT "evolution_proposals_regression_run_id_project_id_fkey" FOREIGN KEY ("regression_run_id", "project_id") REFERENCES "evaluation_runs"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;
