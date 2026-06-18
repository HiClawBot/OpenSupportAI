DROP INDEX IF EXISTS "webhook_events_provider_external_event_id_key";

CREATE UNIQUE INDEX "webhook_events_project_id_provider_external_event_id_key"
  ON "webhook_events"("project_id", "provider", "external_event_id");
