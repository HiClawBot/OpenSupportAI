import { z } from "zod";

const metadataSchema = z.record(z.string(), z.unknown()).default({});

export const createConversationBodySchema = z.object({
  project_id: z.string().min(1),
  inbox_id: z.string().min(1).optional(),
  contact: z
    .object({
      external_user_id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      avatar_url: z.string().url().optional()
    })
    .default({}),
  metadata: metadataSchema.optional()
});

export const sendMessageBodySchema = z.object({
  type: z.literal("text").default("text"),
  text: z.string().min(1).max(8000)
});

export const requestHandoffBodySchema = z.object({
  reason: z
    .enum(["user_requested", "low_confidence", "sensitive", "policy"])
    .default("user_requested"),
  note: z.string().max(2000).optional()
});

export const createProjectBodySchema = z.object({
  name: z.string().min(1).max(120),
  default_locale: z.string().min(2).max(16).default("zh-CN")
});

export const listApiKeysQuerySchema = z.object({
  include_revoked: z.coerce.boolean().default(false)
});

export const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.string().trim().min(1).max(80)).min(1).max(20).default(["admin:project"])
});

export const createKnowledgeDocumentBodySchema = z.object({
  title: z.string().min(1).max(200),
  source_type: z.enum(["markdown", "text", "url", "pdf"]).default("markdown"),
  content: z.string().min(1).max(200_000),
  source_uri: z.string().url().optional(),
  metadata: metadataSchema.optional()
});

export const listConversationsQuerySchema = z.object({
  status: z.enum(["open", "pending_ai", "handoff_requested", "handed_off", "closed"]).optional(),
  assignee_type: z.enum(["ai", "human", "none"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export const listAsyncJobsQuerySchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).optional(),
  type: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const createAsyncJobBodySchema = z.object({
  type: z.string().trim().min(1).max(120),
  payload: metadataSchema.optional(),
  run_at: z.string().datetime().optional(),
  max_attempts: z.number().int().min(1).max(10).default(3)
});

export const listWebhookEventsQuerySchema = z.object({
  provider: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["received", "processed", "failed", "ignored"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const retryWebhookEventBodySchema = z.object({
  run_at: z.string().datetime().optional()
});

export const listAuditLogsQuerySchema = z.object({
  action: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const listToolsQuerySchema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100)
});

export const upsertToolDefinitionBodySchema = z.object({
  slug: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  kind: z.enum(["demo", "openapi"]).default("openapi"),
  status: z.enum(["active", "disabled"]).default("active"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  path: z.string().trim().min(1).max(500).optional(),
  input_schema: metadataSchema.optional(),
  output_schema: metadataSchema.optional(),
  metadata: metadataSchema.optional()
});

export const updateToolDefinitionBodySchema = z.object({
  status: z.enum(["active", "disabled"])
});

export const listToolCallsQuerySchema = z.object({
  conversation_id: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const upsertLlmProviderBodySchema = z.object({
  provider: z.literal("openai_compatible").default("openai_compatible"),
  base_url: z.string().min(1),
  model: z.string().min(1),
  embedding_model: z.string().optional(),
  api_key: z.string().min(1),
  status: z.enum(["active", "disabled"]).default("active")
});

export const upsertChatwootIntegrationBodySchema = z.object({
  base_url: z.string().url(),
  account_id: z.string().min(1),
  inbox_id: z.string().min(1),
  api_access_token: z.string().min(1),
  webhook_secret: z.string().min(1),
  status: z.enum(["active", "disabled"]).default("active")
});

export const chatwootWebhookBodySchema = z.record(z.string(), z.unknown());
