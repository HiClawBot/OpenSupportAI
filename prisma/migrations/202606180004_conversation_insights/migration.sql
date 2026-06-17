CREATE TABLE "conversation_insights" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "suggested_replies" JSONB NOT NULL DEFAULT '[]',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversation_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_insights_conversation_id_key" ON "conversation_insights"("conversation_id");
CREATE INDEX "conversation_insights_project_id_updated_at_idx" ON "conversation_insights"("project_id", "updated_at");

ALTER TABLE "conversation_insights"
  ADD CONSTRAINT "conversation_insights_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_insights"
  ADD CONSTRAINT "conversation_insights_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
