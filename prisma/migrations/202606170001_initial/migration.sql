CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "organizations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "projects" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "public_key" TEXT NOT NULL,
  "default_locale" TEXT NOT NULL DEFAULT 'zh-CN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inboxes" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "handoff_provider" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contacts" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "external_user_id" TEXT,
  "name" TEXT,
  "email" TEXT,
  "avatar_url" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "inbox_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "assignee_type" TEXT NOT NULL DEFAULT 'ai',
  "last_message_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'public',
  "content_type" TEXT NOT NULL DEFAULT 'text',
  "content" JSONB NOT NULL,
  "source_refs" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_sources" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_documents" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "source_id" TEXT,
  "title" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_uri" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "content_hash" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_chunks" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(1536),
  "token_count" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "llm_providers" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'openai_compatible',
  "base_url" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "embedding_model" TEXT,
  "api_key_encrypted" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_runs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "message_id" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "latency_ms" INTEGER,
  "retrieved_chunk_ids" JSONB NOT NULL DEFAULT '[]',
  "confidence" DOUBLE PRECISION,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "handoff_sessions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_contact_id" TEXT,
  "external_conversation_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "reason" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "handoff_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_configs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "config_encrypted" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_event_id" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_keys" (
  "id" TEXT NOT NULL,
  "project_id" TEXT,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_public_key_key" ON "projects"("public_key");
CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");
CREATE INDEX "inboxes_project_id_idx" ON "inboxes"("project_id");
CREATE INDEX "contacts_project_id_idx" ON "contacts"("project_id");
CREATE INDEX "contacts_project_id_external_user_id_idx" ON "contacts"("project_id", "external_user_id");
CREATE INDEX "contacts_project_id_email_idx" ON "contacts"("project_id", "email");
CREATE INDEX "conversations_project_id_idx" ON "conversations"("project_id");
CREATE INDEX "conversations_project_id_contact_id_idx" ON "conversations"("project_id", "contact_id");
CREATE INDEX "conversations_project_id_status_idx" ON "conversations"("project_id", "status");
CREATE INDEX "conversations_project_id_last_message_at_idx" ON "conversations"("project_id", "last_message_at");
CREATE INDEX "messages_project_id_idx" ON "messages"("project_id");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX "messages_project_id_created_at_idx" ON "messages"("project_id", "created_at");
CREATE INDEX "knowledge_sources_project_id_idx" ON "knowledge_sources"("project_id");
CREATE INDEX "knowledge_documents_project_id_status_idx" ON "knowledge_documents"("project_id", "status");
CREATE INDEX "knowledge_documents_project_id_content_hash_idx" ON "knowledge_documents"("project_id", "content_hash");
CREATE INDEX "knowledge_documents_source_id_idx" ON "knowledge_documents"("source_id");
CREATE INDEX "knowledge_chunks_project_id_idx" ON "knowledge_chunks"("project_id");
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");
CREATE INDEX "knowledge_chunks_project_id_document_id_idx" ON "knowledge_chunks"("project_id", "document_id");
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING ivfflat ("embedding" vector_cosine_ops);
CREATE INDEX "llm_providers_project_id_idx" ON "llm_providers"("project_id");
CREATE INDEX "llm_providers_project_id_status_idx" ON "llm_providers"("project_id", "status");
CREATE INDEX "ai_runs_project_id_created_at_idx" ON "ai_runs"("project_id", "created_at");
CREATE INDEX "ai_runs_conversation_id_created_at_idx" ON "ai_runs"("conversation_id", "created_at");
CREATE INDEX "ai_runs_message_id_idx" ON "ai_runs"("message_id");
CREATE INDEX "ai_runs_status_idx" ON "ai_runs"("status");
CREATE INDEX "handoff_sessions_project_id_idx" ON "handoff_sessions"("project_id");
CREATE INDEX "handoff_sessions_conversation_id_idx" ON "handoff_sessions"("conversation_id");
CREATE UNIQUE INDEX "handoff_sessions_provider_external_conversation_id_key" ON "handoff_sessions"("provider", "external_conversation_id");
CREATE UNIQUE INDEX "integration_configs_project_id_provider_key" ON "integration_configs"("project_id", "provider");
CREATE INDEX "webhook_events_project_id_provider_idx" ON "webhook_events"("project_id", "provider");
CREATE UNIQUE INDEX "webhook_events_provider_external_event_id_key" ON "webhook_events"("provider", "external_event_id");
CREATE INDEX "webhook_events_status_created_at_idx" ON "webhook_events"("status", "created_at");
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_project_id_idx" ON "api_keys"("project_id");
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys"("organization_id");

ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "inboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "handoff_sessions" ADD CONSTRAINT "handoff_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_sessions" ADD CONSTRAINT "handoff_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
