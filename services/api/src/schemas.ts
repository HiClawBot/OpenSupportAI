import { z } from "zod";
import { DETERMINISTIC_EVALUATOR_VERSION } from "@opensupportai/evals";

const metadataSchema = z.record(z.string(), z.unknown()).default({});
const httpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    },
    { message: "URL must use http or https" }
  );

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

export const listClientMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.string().trim().min(1).max(120).optional()
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

const adminScopeSchema = z.enum([
  "admin:project",
  "admin:ops",
  "admin:conversations",
  "admin:knowledge",
  "admin:llm",
  "admin:integrations",
  "admin:channels",
  "admin:keys",
  "admin:audit",
  "admin:tools",
  "admin:assist",
  "admin:jobs",
  "admin:webhooks",
  "admin:evolution"
]);

export const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(adminScopeSchema).min(1).max(20).default(["admin:project"])
});

export const createKnowledgeDocumentBodySchema = z.object({
  title: z.string().min(1).max(200),
  source_type: z.enum(["markdown", "text", "url", "pdf"]).default("markdown"),
  content: z.string().min(1).max(200_000),
  source_uri: z.string().url().optional(),
  metadata: metadataSchema.optional()
});

export const reindexKnowledgeDocumentBodySchema = z.object({
  run_at: z.string().datetime().optional()
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
  type: z.literal("knowledge.index"),
  payload: metadataSchema.optional(),
  run_at: z.string().datetime().optional(),
  max_attempts: z.number().int().min(1).max(10).default(3)
});

export const listWebhookEventsQuerySchema = z.object({
  provider: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["received", "processing", "processed", "failed", "ignored"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
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
  base_url: httpUrlSchema,
  model: z.string().min(1),
  embedding_model: z.string().optional(),
  api_key: z.string().min(1),
  status: z.enum(["active", "disabled"]).default("active")
});

export const upsertChatwootIntegrationBodySchema = z.object({
  base_url: httpUrlSchema,
  account_id: z.string().min(1),
  inbox_id: z.string().min(1),
  api_access_token: z.string().min(1),
  webhook_secret: z.string().min(1),
  status: z.enum(["active", "disabled"]).default("active")
});

export const upsertGenericWebhookChannelBodySchema = z.object({
  webhook_secret: z.string().min(8).max(500),
  secret_header: z.string().trim().min(1).max(120).default("x-opensupportai-webhook-secret"),
  status: z.enum(["active", "disabled"]).default("active")
});

export const upsertSlackChannelBodySchema = z.object({
  signing_secret: z.string().min(8).max(500),
  default_channel_id: z.string().trim().min(1).max(120).optional(),
  default_inbox_id: z.string().trim().min(1).max(120).default("inbox_default"),
  status: z.enum(["active", "disabled"]).default("active")
});

const evaluationCategorySchema = z.enum([
  "faq",
  "ambiguity",
  "prompt_injection",
  "missing_identity",
  "tool_failure",
  "llm_failure",
  "handoff"
]);

const evaluationOutcomeSchema = z.enum([
  "grounded",
  "no_hit",
  "needs_identity",
  "tool",
  "degraded",
  "handoff",
  "unknown"
]);

const evaluationThresholdsBodySchema = z.object({
  min_score: z.number().min(0).max(100),
  min_pass_rate: z.number().min(0).max(1),
  require_critical_pass: z.boolean()
});

const evaluationExpectationsBodySchema = z.object({
  outcome: evaluationOutcomeSchema,
  conversation_status: z.string().trim().min(1).max(80).optional(),
  ai_run_status: z.string().trim().min(1).max(80).optional(),
  min_citations: z.number().int().min(0).max(100).optional(),
  min_handoff_sessions: z.number().int().min(0).max(100).optional(),
  tool_call_status: z.string().trim().min(1).max(80).optional(),
  required_answer_metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  answer_includes: z.array(z.string().min(1).max(500)).max(20).optional(),
  answer_excludes: z.array(z.string().min(1).max(500)).max(20).optional()
});

const evaluationScenarioBodySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  category: evaluationCategorySchema,
  critical: z.boolean().default(false),
  input: metadataSchema,
  expectations: evaluationExpectationsBodySchema,
  metadata: metadataSchema.optional()
});

export const createEvaluationSuiteBodySchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    version: z.number().int().min(1).max(1_000_000),
    name: z.string().trim().min(1).max(200),
    evaluator_version: z.literal(DETERMINISTIC_EVALUATOR_VERSION),
    thresholds: evaluationThresholdsBodySchema,
    scenarios: z.array(evaluationScenarioBodySchema).min(1).max(500),
    metadata: metadataSchema.optional()
  })
  .superRefine((value, context) => {
    const slugs = new Set<string>();
    for (const scenario of value.scenarios) {
      if (slugs.has(scenario.slug)) {
        context.addIssue({
          code: "custom",
          message: `Scenario slug must be unique within the suite: ${scenario.slug}`,
          path: ["scenarios"]
        });
      }
      slugs.add(scenario.slug);
    }
  });

export const listEvaluationSuitesQuerySchema = z.object({
  status: z.enum(["draft", "active", "retired"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const evaluationObservationBodySchema = z.object({
  conversation_status: z.string().trim().min(1).max(80),
  answer: z
    .object({
      text: z.string().max(20_000),
      metadata: metadataSchema,
      source_refs: z.array(metadataSchema).max(100)
    })
    .optional(),
  ai_run: z
    .object({
      status: z.string().trim().min(1).max(80),
      metadata: metadataSchema
    })
    .optional(),
  tool_calls: z
    .array(
      z.object({
        status: z.string().trim().min(1).max(80),
        tool_slug: z.string().trim().min(1).max(120)
      })
    )
    .max(100)
    .default([]),
  handoff_sessions: z.number().int().min(0).max(100)
});

export const createEvaluationRunBodySchema = z.object({
  suite_id: z.string().trim().min(1).max(120),
  observations: z
    .array(
      z.object({
        scenario_slug: z.string().trim().min(1).max(120),
        observation: evaluationObservationBodySchema
      })
    )
    .min(1)
    .max(500)
});

export const listEvaluationRunsQuerySchema = z.object({
  status: z.enum(["passed", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const createEvolutionProposalBodySchema = z.object({
  source_run_id: z.string().trim().min(1).max(120),
  kind: z.enum(["knowledge", "prompt", "tool"]),
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(4000),
  artifact: metadataSchema,
  baseline: metadataSchema.optional()
});

export const listEvolutionProposalsQuerySchema = z.object({
  status: z
    .enum([
      "draft",
      "approved",
      "regression_passed",
      "canary",
      "promoted",
      "rejected",
      "rolled_back"
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const nonEmptyEvidenceSchema = metadataSchema.refine((value) => Object.keys(value).length > 0, {
  message: "Evidence must not be empty"
});

export const transitionEvolutionProposalBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    review_note: z.string().trim().max(2000).optional()
  }),
  z.object({
    action: z.literal("reject"),
    review_note: z.string().trim().min(1).max(2000)
  }),
  z.object({
    action: z.literal("record_regression"),
    regression_run_id: z.string().trim().min(1).max(120),
    review_note: z.string().trim().max(2000).optional()
  }),
  z.object({
    action: z.literal("start_canary"),
    canary_evidence: nonEmptyEvidenceSchema,
    rollback_target: nonEmptyEvidenceSchema,
    review_note: z.string().trim().max(2000).optional()
  }),
  z.object({
    action: z.literal("promote"),
    canary_evidence: nonEmptyEvidenceSchema,
    review_note: z.string().trim().max(2000).optional()
  }),
  z.object({
    action: z.literal("rollback"),
    rollback_evidence: nonEmptyEvidenceSchema,
    rollback_target: nonEmptyEvidenceSchema.optional(),
    review_note: z.string().trim().max(2000).optional()
  })
]);

export const chatwootWebhookBodySchema = z.record(z.string(), z.unknown());

export const genericChannelWebhookBodySchema = z.record(z.string(), z.unknown());
