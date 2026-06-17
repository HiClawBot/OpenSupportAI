CREATE TABLE "tool_definitions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'demo',
  "status" TEXT NOT NULL DEFAULT 'active',
  "method" TEXT,
  "path" TEXT,
  "input_schema" JSONB NOT NULL DEFAULT '{}',
  "output_schema" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tool_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tool_calls" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "message_id" TEXT,
  "tool_id" TEXT,
  "tool_slug" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "input" JSONB NOT NULL DEFAULT '{}',
  "output" JSONB,
  "error" TEXT,
  "latency_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tool_calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tool_definitions_project_id_slug_key" ON "tool_definitions"("project_id", "slug");
CREATE INDEX "tool_definitions_project_id_status_idx" ON "tool_definitions"("project_id", "status");
CREATE INDEX "tool_calls_project_id_created_at_idx" ON "tool_calls"("project_id", "created_at");
CREATE INDEX "tool_calls_conversation_id_created_at_idx" ON "tool_calls"("conversation_id", "created_at");
CREATE INDEX "tool_calls_tool_slug_created_at_idx" ON "tool_calls"("tool_slug", "created_at");

ALTER TABLE "tool_definitions"
  ADD CONSTRAINT "tool_definitions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tool_calls"
  ADD CONSTRAINT "tool_calls_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tool_calls"
  ADD CONSTRAINT "tool_calls_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tool_calls"
  ADD CONSTRAINT "tool_calls_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tool_calls"
  ADD CONSTRAINT "tool_calls_tool_id_fkey"
  FOREIGN KEY ("tool_id") REFERENCES "tool_definitions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
