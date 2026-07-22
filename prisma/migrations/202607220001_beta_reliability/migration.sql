ALTER TABLE "conversations"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "idempotency_hash" TEXT;

ALTER TABLE "messages"
  ADD COLUMN "sequence" BIGSERIAL NOT NULL,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "idempotency_hash" TEXT;

ALTER TABLE "async_jobs"
  ADD COLUMN "lease_expires_at" TIMESTAMP(3);

ALTER TABLE "webhook_events"
  ADD COLUMN "processing_started_at" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

UPDATE "async_jobs"
SET
  "status" = CASE WHEN "attempts" >= "max_attempts" THEN 'failed' ELSE 'queued' END,
  "run_at" = CASE WHEN "attempts" < "max_attempts" THEN CURRENT_TIMESTAMP ELSE "run_at" END,
  "locked_by" = NULL,
  "locked_at" = NULL,
  "lease_expires_at" = NULL,
  "error" = CASE
    WHEN "attempts" >= "max_attempts" THEN 'Recovered during lease migration after maximum attempts'
    ELSE 'Recovered during lease migration'
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'running';

WITH ranked AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "project_id", "external_user_id"
      ORDER BY "created_at", "id"
    ) AS "keep_id",
    ROW_NUMBER() OVER (
      PARTITION BY "project_id", "external_user_id"
      ORDER BY "created_at", "id"
    ) AS "position"
  FROM "contacts"
  WHERE "external_user_id" IS NOT NULL
), duplicates AS (
  SELECT "id", "keep_id" FROM ranked WHERE "position" > 1
)
UPDATE "conversations" AS conversation
SET "contact_id" = duplicates."keep_id"
FROM duplicates
WHERE conversation."contact_id" = duplicates."id";

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "project_id", "external_user_id"
      ORDER BY "created_at", "id"
    ) AS "position"
  FROM "contacts"
  WHERE "external_user_id" IS NOT NULL
)
DELETE FROM "contacts"
USING ranked
WHERE "contacts"."id" = ranked."id" AND ranked."position" > 1;

UPDATE "contacts" SET "email" = LOWER(BTRIM("email")) WHERE "email" IS NOT NULL;

WITH ranked AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "project_id", "email"
      ORDER BY "created_at", "id"
    ) AS "keep_id",
    ROW_NUMBER() OVER (
      PARTITION BY "project_id", "email"
      ORDER BY "created_at", "id"
    ) AS "position"
  FROM "contacts"
  WHERE "email" IS NOT NULL
), duplicates AS (
  SELECT "id", "keep_id" FROM ranked WHERE "position" > 1
)
UPDATE "conversations" AS conversation
SET "contact_id" = duplicates."keep_id"
FROM duplicates
WHERE conversation."contact_id" = duplicates."id";

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "project_id", "email"
      ORDER BY "created_at", "id"
    ) AS "position"
  FROM "contacts"
  WHERE "email" IS NOT NULL
)
DELETE FROM "contacts"
USING ranked
WHERE "contacts"."id" = ranked."id" AND ranked."position" > 1;

DROP INDEX IF EXISTS "contacts_project_id_external_user_id_idx";
DROP INDEX IF EXISTS "contacts_project_id_email_idx";
DROP INDEX IF EXISTS "handoff_sessions_provider_external_conversation_id_key";

CREATE UNIQUE INDEX "inboxes_id_project_id_key" ON "inboxes"("id", "project_id");
CREATE UNIQUE INDEX "contacts_id_project_id_key" ON "contacts"("id", "project_id");
CREATE UNIQUE INDEX "conversations_id_project_id_key" ON "conversations"("id", "project_id");
CREATE UNIQUE INDEX "contacts_project_id_external_user_id_key"
  ON "contacts"("project_id", "external_user_id");
CREATE UNIQUE INDEX "contacts_project_id_email_key"
  ON "contacts"("project_id", "email");
CREATE UNIQUE INDEX "conversations_project_id_idempotency_key_key"
  ON "conversations"("project_id", "idempotency_key");
CREATE UNIQUE INDEX "messages_conversation_id_idempotency_key_key"
  ON "messages"("conversation_id", "idempotency_key");
CREATE UNIQUE INDEX "messages_sequence_key" ON "messages"("sequence");
CREATE UNIQUE INDEX "handoff_project_provider_external_conversation_key"
  ON "handoff_sessions"("project_id", "provider", "external_conversation_id");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_inbox_id_project_id_fkey"
  FOREIGN KEY ("inbox_id", "project_id") REFERENCES "inboxes"("id", "project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "conversations_contact_id_project_id_fkey"
  FOREIGN KEY ("contact_id", "project_id") REFERENCES "contacts"("id", "project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversation_id_project_id_fkey"
  FOREIGN KEY ("conversation_id", "project_id") REFERENCES "conversations"("id", "project_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "handoff_sessions"
  ADD CONSTRAINT "handoff_sessions_conversation_id_project_id_fkey"
  FOREIGN KEY ("conversation_id", "project_id") REFERENCES "conversations"("id", "project_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
