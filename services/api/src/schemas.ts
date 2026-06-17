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

export const createKnowledgeDocumentBodySchema = z.object({
  title: z.string().min(1).max(200),
  source_type: z.enum(["markdown", "text", "url", "pdf"]).default("markdown"),
  content: z.string().min(1).max(200_000),
  source_uri: z.string().url().optional(),
  metadata: metadataSchema.optional()
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
