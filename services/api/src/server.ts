import {
  channelAdapterCatalog,
  createGenericWebhookAdapter,
  createSlackAdapter,
  createStubChannelAdapter,
  isSlackUrlVerificationPayload,
  verifySlackWebhookSignature,
  type GenericWebhookAdapterConfig,
  type SlackAdapterConfig,
  type StubChannelProvider
} from "@opensupportai/adapter-channels";
import { createChatwootAdapter, type ChatwootAdapterConfig } from "@opensupportai/adapter-chatwoot";
import { OpenAICompatibleClient } from "@opensupportai/llm";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type {
  ChannelProvider,
  ConversationStatus,
  HandoffReason,
  NormalizedInboundChannelMessage
} from "@opensupportai/protocol";
import { ZodError } from "zod";
import { authenticateAdminIdentity, authenticateClient, type AdminIdentity } from "./auth";
import { type ApiConfig, loadConfig } from "./config";
import { decryptJson, encryptJson, hashSecret } from "./crypto";
import {
  ApiError,
  forbidden,
  invalidRequest,
  notFound,
  rateLimited,
  toApiErrorResponse,
  unauthorized
} from "./errors";
import { EventHub, formatSse } from "./event-hub";
import { buildHandoffAnalytics, generateConversationInsight } from "./agent-assist";
import { createOrchestrator, requestHandoff, type GroundedAnswerGenerator } from "./orchestrator";
import { MemorySupportRepository } from "./repositories/memory";
import { PrismaSupportRepository } from "./repositories/prisma";
import type {
  ApiKeyRecord,
  AuditLogRecord,
  ContactRecord,
  ConversationRecord,
  HandoffSessionRecord,
  InboxRecord,
  IntegrationConfigRecord,
  JsonRecord,
  KnowledgeChunkRecord,
  LlmProviderRecord,
  MessageRecord,
  ProjectRecord,
  SupportRepository,
  WebhookEventRecord
} from "./repositories/types";
import {
  chatwootWebhookBodySchema,
  createApiKeyBodySchema,
  createAsyncJobBodySchema,
  createConversationBodySchema,
  createKnowledgeDocumentBodySchema,
  createProjectBodySchema,
  genericChannelWebhookBodySchema,
  listApiKeysQuerySchema,
  listAuditLogsQuerySchema,
  listAsyncJobsQuerySchema,
  listConversationsQuerySchema,
  listToolCallsQuerySchema,
  listToolsQuerySchema,
  listWebhookEventsQuerySchema,
  reindexKnowledgeDocumentBodySchema,
  requestHandoffBodySchema,
  retryWebhookEventBodySchema,
  sendMessageBodySchema,
  updateToolDefinitionBodySchema,
  upsertChatwootIntegrationBodySchema,
  upsertGenericWebhookChannelBodySchema,
  upsertLlmProviderBodySchema,
  upsertSlackChannelBodySchema,
  upsertToolDefinitionBodySchema
} from "./schemas";

export type BuildAppOptions = {
  config?: ApiConfig;
  repository?: SupportRepository;
  eventHub?: EventHub;
  chatwootFetch?: typeof fetch;
  llmFetch?: typeof fetch;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const repository =
    options.repository ??
    (config.storageMode === "memory"
      ? new MemorySupportRepository()
      : new PrismaSupportRepository());
  const eventHub = options.eventHub ?? new EventHub();
  const handoffRequester = (input: {
    projectId: string;
    conversationId: string;
    reason: HandoffReason;
    note?: string;
  }) =>
    requestHandoffWithConfiguredProvider({
      repository,
      eventHub,
      config,
      chatwootFetch: options.chatwootFetch,
      ...input
    });
  const orchestrator = createOrchestrator(repository, eventHub, {
    requestHandoff: handoffRequester,
    generateGroundedAnswer: createLlmGroundedAnswerGenerator(config, options.llmFetch)
  });
  await repository.seedDemo();

  const app = Fastify({
    logger: config.nodeEnv !== "test",
    genReqId: () => `req_${crypto.randomUUID()}`
  });

  await app.register(cors, {
    origin: config.corsOrigin
  });
  registerRateLimit(app, config);

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    if (error instanceof ZodError) {
      const apiError = invalidRequest(error.issues.map((issue) => issue.message).join("; "));
      reply.status(apiError.statusCode).send(toApiErrorResponse(apiError, requestId));
      return;
    }
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send(toApiErrorResponse(error, requestId));
      return;
    }

    request.log.error(error);
    const apiError = new ApiError("internal_error", "Internal server error", 500);
    reply.status(apiError.statusCode).send(toApiErrorResponse(apiError, requestId));
  });

  app.get("/health", async () => ({ status: "ok", service: "@opensupportai/api" }));
  app.get("/v1/health", async () => ({ status: "ok", service: "@opensupportai/api" }));

  app.post("/v1/client/conversations", async (request) => {
    const body = createConversationBodySchema.parse(request.body);
    const project = await authenticateClient(request, repository, body.project_id);
    const inbox = await repository.findInbox(project.id, body.inbox_id);
    if (!inbox) {
      throw notFound("Inbox not found");
    }

    const contact = await repository.upsertContact(project.id, {
      externalUserId: body.contact.external_user_id,
      name: body.contact.name,
      email: body.contact.email,
      avatarUrl: body.contact.avatar_url,
      metadata: {}
    });
    const conversation = await repository.createConversation({
      projectId: project.id,
      inboxId: inbox.id,
      contactId: contact.id,
      metadata: body.metadata
    });

    return {
      conversation_id: conversation.id,
      status: conversation.status
    };
  });

  app.get("/v1/client/conversations/:conversationId/messages", async (request) => {
    const params = request.params as { conversationId: string };
    const project = await authenticateClient(request, repository);
    const conversation = await repository.findConversation(project.id, params.conversationId);
    if (!conversation) {
      throw notFound("Conversation not found");
    }

    return {
      messages: await repository.listMessages(project.id, conversation.id)
    };
  });

  app.post("/v1/client/conversations/:conversationId/messages", async (request) => {
    const params = request.params as { conversationId: string };
    const body = sendMessageBodySchema.parse(request.body);
    const project = await authenticateClient(request, repository);
    const conversation = await repository.findConversation(project.id, params.conversationId);
    if (!conversation) {
      throw notFound("Conversation not found");
    }

    const message = await repository.createMessage({
      projectId: project.id,
      conversationId: conversation.id,
      message: {
        role: "end_user",
        text: body.text
      }
    });
    eventHub.publish(project.id, conversation.id, {
      event: "message.created",
      data: { message }
    });

    await orchestrator.respondToUserMessage({
      projectId: project.id,
      conversationId: conversation.id,
      message
    });

    return {
      message_id: message.id,
      conversation_id: conversation.id,
      status: "accepted"
    };
  });

  app.get("/v1/client/conversations/:conversationId/events", async (request, reply) => {
    const params = request.params as { conversationId: string };
    const query = request.query as { once?: string };
    const project = await authenticateClient(request, repository);
    const conversation = await repository.findConversation(project.id, params.conversationId);
    if (!conversation) {
      throw notFound("Conversation not found");
    }

    if (query.once === "true") {
      reply.header("content-type", "text/event-stream");
      return formatSse({
        event: "conversation.status_changed",
        data: {
          conversationId: conversation.id,
          status: conversation.status
        }
      });
    }

    writeSseHeaders(reply);
    const unsubscribe = eventHub.subscribe(project.id, conversation.id, {
      send: (event) => {
        reply.raw.write(formatSse(event));
      }
    });
    reply.raw.write(
      formatSse({
        event: "conversation.status_changed",
        data: {
          conversationId: conversation.id,
          status: conversation.status
        }
      })
    );
    request.raw.on("close", unsubscribe);
  });

  app.post("/v1/client/conversations/:conversationId/handoff", async (request) => {
    const params = request.params as { conversationId: string };
    const body = requestHandoffBodySchema.parse(request.body);
    const project = await authenticateClient(request, repository);
    const conversation = await repository.findConversation(project.id, params.conversationId);
    if (!conversation) {
      throw notFound("Conversation not found");
    }

    const handoffSession = await handoffRequester({
      projectId: project.id,
      conversationId: conversation.id,
      reason: body.reason,
      note: body.note
    });
    return {
      conversation_id: conversation.id,
      status: clientHandoffStatus(handoffSession)
    };
  });

  app.post("/v1/channel-webhooks/generic", async (request) => {
    const body = genericChannelWebhookBodySchema.parse(request.body);
    const project = await authenticateClient(request, repository, stringValue(body["project_id"]));
    const integration = await repository.getIntegrationConfig(project.id, "generic_webhook");
    if (integration?.status === "disabled") {
      throw forbidden("Generic webhook channel is disabled");
    }
    const adapter = createGenericWebhookAdapter(
      integration
        ? genericWebhookAdapterConfig(
            decryptJson(integration.configEncrypted, config.encryptionKey)
          )
        : {}
    );
    let webhookEvent: Awaited<ReturnType<SupportRepository["createWebhookEvent"]>> | undefined;

    try {
      const normalized = await adapter.normalizeInboundWebhook({
        headers: normalizeRequestHeaders(request),
        payload: body
      });
      webhookEvent = await repository.createWebhookEvent({
        projectId: project.id,
        provider: normalized.provider,
        externalEventId: normalized.externalEventId,
        payload: body
      });
      const idempotentResponse = idempotentWebhookResponse(webhookEvent, normalized.provider);
      if (idempotentResponse) {
        return idempotentResponse;
      }

      const inbox = await repository.findInbox(project.id, normalized.inboxId);
      if (!inbox) {
        throw notFound("Inbox not found");
      }

      const conversation = await findOrCreateChannelConversation(repository, {
        project,
        inbox,
        normalized
      });
      const message = await repository.createMessage({
        projectId: project.id,
        conversationId: conversation.id,
        message: {
          role: "end_user",
          text: normalized.message.text,
          metadata: {
            ...normalized.metadata,
            channel: channelMessageMetadata(normalized)
          }
        }
      });
      eventHub.publish(project.id, conversation.id, {
        event: "message.created",
        data: { message }
      });

      await orchestrator.respondToUserMessage({
        projectId: project.id,
        conversationId: conversation.id,
        message
      });

      await repository.markWebhookEvent({
        id: webhookEvent.id,
        status: "processed"
      });
      return {
        status: "processed",
        provider: normalized.provider,
        webhook_event_id: webhookEvent.id,
        conversation_id: conversation.id,
        message_id: message.id
      };
    } catch (error) {
      webhookEvent ??= await repository.createWebhookEvent({
        projectId: project.id,
        provider: "generic_webhook",
        externalEventId:
          stringValue(body["event_id"]) ??
          stringValue(body["eventId"]) ??
          stringValue(body["id"]) ??
          stringValue(recordValue(body["message"])?.["id"]) ??
          stringValue(body["message_id"]),
        payload: body
      });
      await repository.markWebhookEvent({
        id: webhookEvent.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown channel webhook error"
      });
      if (error instanceof Error && error.message === "Invalid generic webhook secret") {
        throw unauthorized("Invalid generic webhook secret");
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw invalidRequest(error instanceof Error ? error.message : "Invalid generic webhook");
    }
  });

  app.post("/v1/channel-webhooks/slack", async (request) => {
    const body = genericChannelWebhookBodySchema.parse(request.body);
    const project = await authenticateClient(request, repository, stringValue(body["project_id"]));
    const integration = await repository.getIntegrationConfig(project.id, "slack");
    if (!integration) {
      throw forbidden("Slack channel is not configured");
    }
    if (integration.status === "disabled") {
      throw forbidden("Slack channel is disabled");
    }

    const adapterConfig = slackAdapterConfig(
      decryptJson(integration.configEncrypted, config.encryptionKey)
    );
    const headers = normalizeRequestHeaders(request);
    const rawBody = JSON.stringify(body);
    if (isSlackUrlVerificationPayload(body)) {
      try {
        verifySlackWebhookSignature({ headers, payload: body, rawBody }, adapterConfig);
      } catch (error) {
        throw unauthorized(error instanceof Error ? error.message : "Invalid Slack signature");
      }
      return {
        challenge: body.challenge
      };
    }

    const adapter = createSlackAdapter(adapterConfig);
    let webhookEvent: Awaited<ReturnType<SupportRepository["createWebhookEvent"]>> | undefined;

    try {
      const normalized = await adapter.normalizeInboundWebhook({
        headers,
        payload: body,
        rawBody
      });
      webhookEvent = await repository.createWebhookEvent({
        projectId: project.id,
        provider: normalized.provider,
        externalEventId: normalized.externalEventId,
        payload: body
      });
      const idempotentResponse = idempotentWebhookResponse(webhookEvent, normalized.provider);
      if (idempotentResponse) {
        return idempotentResponse;
      }

      const inbox = await repository.findInbox(project.id, normalized.inboxId);
      if (!inbox) {
        throw notFound("Inbox not found");
      }

      const conversation = await findOrCreateChannelConversation(repository, {
        project,
        inbox,
        normalized
      });
      const message = await repository.createMessage({
        projectId: project.id,
        conversationId: conversation.id,
        message: {
          role: "end_user",
          text: normalized.message.text,
          metadata: {
            ...normalized.metadata,
            channel: channelMessageMetadata(normalized)
          }
        }
      });
      eventHub.publish(project.id, conversation.id, {
        event: "message.created",
        data: { message }
      });

      await orchestrator.respondToUserMessage({
        projectId: project.id,
        conversationId: conversation.id,
        message
      });

      await repository.markWebhookEvent({
        id: webhookEvent.id,
        status: "processed"
      });
      return {
        status: "processed",
        provider: normalized.provider,
        webhook_event_id: webhookEvent.id,
        conversation_id: conversation.id,
        message_id: message.id
      };
    } catch (error) {
      webhookEvent ??= await repository.createWebhookEvent({
        projectId: project.id,
        provider: "slack",
        externalEventId:
          stringValue(body["event_id"]) ??
          stringValue(recordValue(body["event"])?.["client_msg_id"]) ??
          stringValue(recordValue(body["event"])?.["ts"]),
        payload: body
      });
      await repository.markWebhookEvent({
        id: webhookEvent.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown Slack webhook error"
      });
      if (isSlackSignatureError(error)) {
        throw unauthorized(error instanceof Error ? error.message : "Invalid Slack signature");
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw invalidRequest(error instanceof Error ? error.message : "Invalid Slack webhook");
    }
  });

  app.get("/v1/admin/projects", async (request) => {
    const identity = await authenticateAdminIdentity(request, repository, config);
    return {
      projects: identity.project ? [identity.project] : await repository.listProjects()
    };
  });

  app.post("/v1/admin/projects", async (request) => {
    const identity = await authenticateAdminIdentity(request, repository, config);
    requireRootAdmin(identity);
    const body = createProjectBodySchema.parse(request.body);
    const project = await repository.createProject({
      name: body.name,
      defaultLocale: body.default_locale
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "project.created",
      targetType: "project",
      targetId: project.id,
      metadata: {
        name: project.name,
        default_locale: project.defaultLocale
      }
    });
    return { project };
  });

  app.get("/v1/admin/projects/:projectId/ops/health", async (request) => {
    const { project } = await authenticateAdminProjectIdentity(request, repository, config);
    return buildOpsHealth(repository, project, config);
  });

  app.get("/v1/admin/projects/:projectId/channels/adapters", async (request) => {
    const { identity } = await authenticateAdminProjectIdentity(request, repository, config);
    requireAdminScope(identity, "admin:channels");
    return {
      adapters: channelAdapterCatalog
    };
  });

  app.post("/v1/admin/projects/:projectId/channels/adapters/:provider/test", async (request) => {
    const params = request.params as { provider: string };
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:channels");
    const provider = channelProviderFromParam(params.provider);
    if (!provider) {
      throw notFound("Channel adapter not found");
    }

    const integration =
      provider === "generic_webhook" || provider === "slack"
        ? await repository.getIntegrationConfig(project.id, provider)
        : undefined;
    const adapter =
      provider === "generic_webhook"
        ? createGenericWebhookAdapter(
            integration
              ? genericWebhookAdapterConfig(
                  decryptJson(integration.configEncrypted, config.encryptionKey)
                )
              : {}
          )
        : provider === "slack"
          ? createSlackAdapter(
              integration
                ? slackAdapterConfig(decryptJson(integration.configEncrypted, config.encryptionKey))
                : {}
            )
          : createStubChannelAdapter(provider);
    const result =
      (provider === "generic_webhook" || provider === "slack") && integration?.status === "disabled"
        ? {
            provider,
            ok: false,
            status: "failed" as const,
            message: `${provider} channel is disabled.`
          }
        : await adapter.testConnection();
    await recordAudit(repository, request, {
      project,
      identity,
      action: "channel_adapter.tested",
      targetType: "channel_adapter",
      targetId: provider,
      metadata: {
        ok: result.ok,
        status: result.status
      }
    });
    return { result };
  });

  app.get("/v1/admin/projects/:projectId/channels/generic-webhook", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:channels");
    const integration = await repository.getIntegrationConfig(project.id, "generic_webhook");
    return {
      channel: integration ? safeIntegrationResponse(integration) : null
    };
  });

  app.post("/v1/admin/projects/:projectId/channels/generic-webhook", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:channels");
    const body = upsertGenericWebhookChannelBodySchema.parse(request.body);
    const integration = await repository.upsertIntegrationConfig({
      projectId: project.id,
      provider: "generic_webhook",
      status: body.status,
      configEncrypted: encryptJson(
        {
          webhook_secret: body.webhook_secret,
          secret_header: body.secret_header.toLowerCase()
        },
        config.encryptionKey
      ),
      metadata: {
        secret_configured: true,
        secret_header: body.secret_header.toLowerCase()
      }
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "channel.generic_webhook.upserted",
      targetType: "integration_config",
      targetId: integration.id,
      metadata: {
        provider: integration.provider,
        status: integration.status,
        secret_header: body.secret_header.toLowerCase()
      }
    });
    return {
      channel: safeIntegrationResponse(integration)
    };
  });

  app.get("/v1/admin/projects/:projectId/channels/slack", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:channels");
    const integration = await repository.getIntegrationConfig(project.id, "slack");
    return {
      channel: integration ? safeIntegrationResponse(integration) : null
    };
  });

  app.post("/v1/admin/projects/:projectId/channels/slack", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:channels");
    const body = upsertSlackChannelBodySchema.parse(request.body);
    const integration = await repository.upsertIntegrationConfig({
      projectId: project.id,
      provider: "slack",
      status: body.status,
      configEncrypted: encryptJson(
        {
          signing_secret: body.signing_secret,
          default_channel_id: body.default_channel_id,
          default_inbox_id: body.default_inbox_id
        },
        config.encryptionKey
      ),
      metadata: {
        signing_secret_configured: true,
        default_channel_id: body.default_channel_id,
        default_inbox_id: body.default_inbox_id
      }
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "channel.slack.upserted",
      targetType: "integration_config",
      targetId: integration.id,
      metadata: {
        provider: integration.provider,
        status: integration.status,
        default_channel_id: body.default_channel_id,
        default_inbox_id: body.default_inbox_id
      }
    });
    return {
      channel: safeIntegrationResponse(integration)
    };
  });

  app.get("/v1/admin/projects/:projectId/api-keys", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:keys");
    const query = listApiKeysQuerySchema.parse(request.query);
    return {
      api_keys: (
        await repository.listApiKeys({
          projectId: project.id,
          includeRevoked: query.include_revoked
        })
      ).map(safeApiKeyResponse)
    };
  });

  app.post("/v1/admin/projects/:projectId/api-keys", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:keys");
    const body = createApiKeyBodySchema.parse(request.body);
    const secret = generateApiKeySecret();
    const apiKey = await repository.createApiKey({
      projectId: project.id,
      organizationId: project.organizationId,
      name: body.name,
      keyHash: hashSecret(secret),
      scopes: body.scopes
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "api_key.created",
      targetType: "api_key",
      targetId: apiKey.id,
      metadata: {
        name: apiKey.name,
        scopes: apiKey.scopes
      }
    });
    return {
      api_key: safeApiKeyResponse(apiKey),
      key: secret
    };
  });

  app.delete("/v1/admin/projects/:projectId/api-keys/:keyId", async (request) => {
    const params = request.params as { keyId: string };
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:keys");
    const existingApiKey = (
      await repository.listApiKeys({
        projectId: project.id,
        includeRevoked: true
      })
    ).find((apiKey) => apiKey.id === params.keyId);
    if (!existingApiKey) {
      throw notFound("API key not found");
    }

    const apiKey = await repository.revokeApiKey({
      projectId: project.id,
      id: params.keyId
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "api_key.revoked",
      targetType: "api_key",
      targetId: apiKey.id,
      metadata: {
        name: apiKey.name
      }
    });
    return { api_key: safeApiKeyResponse(apiKey) };
  });

  app.get("/v1/admin/projects/:projectId/audit-log", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:audit");
    const query = listAuditLogsQuerySchema.parse(request.query);
    return {
      audit_logs: await repository.listAuditLogs({
        projectId: project.id,
        action: query.action,
        limit: query.limit
      })
    };
  });

  app.get("/v1/admin/projects/:projectId/tools", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:tools");
    const query = listToolsQuerySchema.parse(request.query);
    return {
      tools: await repository.listToolDefinitions({
        projectId: project.id,
        status: query.status,
        limit: query.limit
      })
    };
  });

  app.post("/v1/admin/projects/:projectId/tools", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:tools");
    const body = upsertToolDefinitionBodySchema.parse(request.body);
    const tool = await repository.upsertToolDefinition({
      projectId: project.id,
      slug: body.slug,
      name: body.name,
      description: body.description,
      kind: body.kind,
      status: body.status,
      method: body.method,
      path: body.path,
      inputSchema: body.input_schema,
      outputSchema: body.output_schema,
      metadata: body.metadata
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "tool_definition.upserted",
      targetType: "tool_definition",
      targetId: tool.id,
      metadata: {
        slug: tool.slug,
        status: tool.status,
        kind: tool.kind
      }
    });
    return { tool };
  });

  app.patch("/v1/admin/projects/:projectId/tools/:toolId", async (request) => {
    const params = request.params as { toolId: string };
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:tools");
    const body = updateToolDefinitionBodySchema.parse(request.body);
    const existingTool = (
      await repository.listToolDefinitions({
        projectId: project.id,
        limit: 100
      })
    ).find((tool) => tool.id === params.toolId);
    if (!existingTool) {
      throw notFound("Tool definition not found");
    }

    const tool = await repository.updateToolDefinitionStatus({
      projectId: project.id,
      id: params.toolId,
      status: body.status
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "tool_definition.status_updated",
      targetType: "tool_definition",
      targetId: tool.id,
      metadata: {
        slug: tool.slug,
        status: tool.status
      }
    });
    return { tool };
  });

  app.get("/v1/admin/projects/:projectId/tool-calls", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:tools");
    const query = listToolCallsQuerySchema.parse(request.query);
    return {
      tool_calls: await repository.listToolCalls({
        projectId: project.id,
        conversationId: query.conversation_id,
        limit: query.limit
      })
    };
  });

  app.get("/v1/admin/projects/:projectId/conversations", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    const query = listConversationsQuerySchema.parse(request.query);
    return buildAdminConversationList(repository, projectId, query);
  });

  app.get("/v1/admin/projects/:projectId/conversations/:conversationId", async (request) => {
    const params = request.params as { projectId: string; conversationId: string };
    const projectId = await authenticateAdminProject(request, repository, config);
    const conversation = await repository.findConversation(projectId, params.conversationId);
    if (!conversation) {
      throw notFound("Conversation not found");
    }
    return {
      conversation,
      channel: channelSummaryFromMetadata(conversation.metadata),
      messages: await repository.listMessages(projectId, conversation.id),
      ai_runs: await repository.listAiRuns(projectId, conversation.id),
      tool_calls: await repository.listToolCalls({
        projectId,
        conversationId: conversation.id
      }),
      insight:
        (await repository.getConversationInsight({
          projectId,
          conversationId: conversation.id
        })) ?? null,
      handoff_sessions: await repository.listHandoffSessions({
        projectId,
        conversationId: conversation.id
      })
    };
  });

  app.get("/v1/admin/projects/:projectId/conversations/:conversationId/assist", async (request) => {
    const params = request.params as { conversationId: string };
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:assist");
    const conversation = await repository.findConversation(project.id, params.conversationId);
    if (!conversation) {
      throw notFound("Conversation not found");
    }
    return {
      insight:
        (await repository.getConversationInsight({
          projectId: project.id,
          conversationId: conversation.id
        })) ?? null
    };
  });

  app.post(
    "/v1/admin/projects/:projectId/conversations/:conversationId/assist",
    async (request) => {
      const params = request.params as { conversationId: string };
      const { project, identity } = await authenticateAdminProjectIdentity(
        request,
        repository,
        config
      );
      requireAdminScope(identity, "admin:assist");
      const conversation = await repository.findConversation(project.id, params.conversationId);
      if (!conversation) {
        throw notFound("Conversation not found");
      }

      const insight = await generateConversationInsight(repository, {
        projectId: project.id,
        conversationId: conversation.id
      });
      await recordAudit(repository, request, {
        project,
        identity,
        action: "conversation_assist.generated",
        targetType: "conversation",
        targetId: conversation.id,
        metadata: {
          tags: insight.tags,
          suggested_reply_count: insight.suggestedReplies.length
        }
      });
      return { insight };
    }
  );

  app.get("/v1/admin/projects/:projectId/analytics/handoffs", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:assist");
    return {
      analytics: await buildHandoffAnalytics(repository, project.id)
    };
  });

  app.get("/v1/admin/projects/:projectId/jobs", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    const query = listAsyncJobsQuerySchema.parse(request.query);
    return {
      jobs: await repository.listAsyncJobs({
        projectId,
        status: query.status,
        type: query.type,
        limit: query.limit
      })
    };
  });

  app.post("/v1/admin/projects/:projectId/jobs", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:jobs");
    const body = createAsyncJobBodySchema.parse(request.body);
    const job = await repository.createAsyncJob({
      projectId: project.id,
      type: body.type,
      payload: body.payload,
      runAt: body.run_at,
      maxAttempts: body.max_attempts
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "async_job.created",
      targetType: "async_job",
      targetId: job.id,
      metadata: {
        type: job.type,
        run_at: job.runAt
      }
    });
    return { job };
  });

  app.get("/v1/admin/projects/:projectId/webhooks/events", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:webhooks");
    const query = listWebhookEventsQuerySchema.parse(request.query);
    return {
      webhook_events: await repository.listWebhookEvents({
        projectId: project.id,
        provider: query.provider,
        status: query.status,
        limit: query.limit
      })
    };
  });

  app.post("/v1/admin/projects/:projectId/webhooks/events/:eventId/retry", async (request) => {
    const params = request.params as { eventId: string };
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    requireAdminScope(identity, "admin:webhooks");
    const body = retryWebhookEventBodySchema.parse(request.body ?? {});
    const event = await repository.findWebhookEvent({
      projectId: project.id,
      id: params.eventId
    });
    if (!event) {
      throw notFound("Webhook event not found");
    }
    if (event.status === "processed") {
      throw invalidRequest("Processed webhook events do not need retry");
    }

    const job = await repository.createAsyncJob({
      projectId: project.id,
      type: "webhook.retry",
      payload: {
        webhook_event_id: event.id,
        provider: event.provider
      },
      runAt: body.run_at
    });
    const updatedEvent = await repository.markWebhookEvent({
      id: event.id,
      status: "received"
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "webhook.retry_scheduled",
      targetType: "webhook_event",
      targetId: event.id,
      metadata: {
        provider: event.provider,
        job_id: job.id
      }
    });
    return {
      webhook_event: updatedEvent,
      job
    };
  });

  app.get("/v1/admin/projects/:projectId/knowledge/documents", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    return {
      documents: await repository.listKnowledgeDocuments(projectId)
    };
  });

  app.post("/v1/admin/projects/:projectId/knowledge/documents", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    const body = createKnowledgeDocumentBodySchema.parse(request.body);
    const document = await repository.createKnowledgeDocument(project.id, {
      title: body.title,
      sourceType: body.source_type,
      content: body.content,
      sourceUri: body.source_uri,
      metadata: body.metadata
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "knowledge_document.created",
      targetType: "knowledge_document",
      targetId: document.id,
      metadata: {
        title: document.title,
        source_type: document.sourceType
      }
    });
    return { document };
  });

  app.post(
    "/v1/admin/projects/:projectId/knowledge/documents/:documentId/reindex",
    async (request) => {
      const { project, identity } = await authenticateAdminProjectIdentity(
        request,
        repository,
        config
      );
      const params = request.params as { documentId: string };
      const body = reindexKnowledgeDocumentBodySchema.parse(request.body ?? {});
      const existing = await repository.findKnowledgeDocument(project.id, params.documentId);
      if (!existing) {
        throw notFound("Knowledge document not found");
      }

      const job = await repository.createAsyncJob({
        projectId: project.id,
        type: "knowledge.index",
        payload: {
          project_id: project.id,
          document_id: existing.id
        },
        runAt: body.run_at,
        maxAttempts: 3
      });
      const document = await repository.updateKnowledgeDocumentIndexState({
        projectId: project.id,
        documentId: existing.id,
        status: "pending",
        metadata: {
          ...existing.metadata,
          last_index_job_id: job.id,
          index_requested_at: new Date().toISOString()
        }
      });
      await recordAudit(repository, request, {
        project,
        identity,
        action: "knowledge_document.reindex_scheduled",
        targetType: "knowledge_document",
        targetId: document.id,
        metadata: {
          job_id: job.id,
          title: document.title
        }
      });
      return { document, job };
    }
  );

  app.get("/v1/admin/projects/:projectId/llm", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    const provider = await repository.getActiveLlmProvider(projectId);
    return {
      provider: provider
        ? {
            ...provider,
            apiKeyEncrypted: undefined,
            api_key_configured: true
          }
        : null
    };
  });

  app.post("/v1/admin/projects/:projectId/llm", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    const body = upsertLlmProviderBodySchema.parse(request.body);
    const provider = await repository.upsertLlmProvider({
      projectId: project.id,
      provider: body.provider,
      baseUrl: body.base_url,
      model: body.model,
      embeddingModel: body.embedding_model,
      apiKeyEncrypted: encryptJson({ api_key: body.api_key }, config.encryptionKey),
      status: body.status
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "llm_provider.upserted",
      targetType: "llm_provider",
      targetId: provider.id,
      metadata: {
        provider: provider.provider,
        model: provider.model,
        status: provider.status
      }
    });
    return {
      provider: {
        ...provider,
        apiKeyEncrypted: undefined,
        api_key_configured: true
      }
    };
  });

  app.get("/v1/admin/projects/:projectId/integrations/chatwoot", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    const integration = await repository.getIntegrationConfig(projectId, "chatwoot");
    return {
      integration: integration
        ? {
            id: integration.id,
            projectId: integration.projectId,
            provider: integration.provider,
            status: integration.status,
            metadata: integration.metadata,
            configured: true,
            createdAt: integration.createdAt,
            updatedAt: integration.updatedAt
          }
        : null
    };
  });

  app.post("/v1/admin/projects/:projectId/integrations/chatwoot", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    const body = upsertChatwootIntegrationBodySchema.parse(request.body);
    const integration = await repository.upsertIntegrationConfig({
      projectId: project.id,
      provider: "chatwoot",
      status: body.status,
      configEncrypted: encryptJson(
        {
          base_url: body.base_url,
          account_id: body.account_id,
          inbox_id: body.inbox_id,
          api_access_token: body.api_access_token,
          webhook_secret: body.webhook_secret
        },
        config.encryptionKey
      ),
      metadata: {
        base_url: body.base_url,
        account_id: body.account_id,
        inbox_id: body.inbox_id
      }
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "integration.chatwoot.upserted",
      targetType: "integration_config",
      targetId: integration.id,
      metadata: {
        provider: integration.provider,
        status: integration.status,
        account_id: body.account_id,
        inbox_id: body.inbox_id
      }
    });
    return {
      integration: {
        id: integration.id,
        projectId: integration.projectId,
        provider: integration.provider,
        status: integration.status,
        metadata: integration.metadata,
        configured: true
      }
    };
  });

  app.post("/v1/admin/projects/:projectId/integrations/chatwoot/test", async (request) => {
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    const integration = await repository.getIntegrationConfig(project.id, "chatwoot");
    if (!integration) {
      throw notFound("Chatwoot integration not configured");
    }

    const testedAt = new Date().toISOString();
    try {
      const adapter = createChatwootAdapter(
        chatwootAdapterConfig(
          decryptJson(integration.configEncrypted, config.encryptionKey),
          options.chatwootFetch
        )
      );
      const result = await adapter.testConnection();
      const metadataWithoutLastError = { ...integration.metadata };
      delete metadataWithoutLastError["last_test_error"];
      const updated = await repository.upsertIntegrationConfig({
        projectId: project.id,
        provider: "chatwoot",
        status: integration.status,
        configEncrypted: integration.configEncrypted,
        metadata: {
          ...metadataWithoutLastError,
          last_tested_at: testedAt,
          last_test_ok: true,
          ...(result.inboxName ? { last_test_inbox_name: result.inboxName } : {})
        }
      });
      await recordAudit(repository, request, {
        project,
        identity,
        action: "integration.chatwoot.tested",
        targetType: "integration_config",
        targetId: updated.id,
        metadata: {
          ok: true,
          inbox_name: result.inboxName
        }
      });
      return {
        ok: true,
        result,
        integration: safeIntegrationResponse(updated)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Chatwoot test error";
      const updated = await repository.upsertIntegrationConfig({
        projectId: project.id,
        provider: "chatwoot",
        status: integration.status,
        configEncrypted: integration.configEncrypted,
        metadata: {
          ...integration.metadata,
          last_tested_at: testedAt,
          last_test_ok: false,
          last_test_error: message
        }
      });
      await recordAudit(repository, request, {
        project,
        identity,
        action: "integration.chatwoot.tested",
        targetType: "integration_config",
        targetId: updated.id,
        metadata: {
          ok: false,
          error: message
        }
      });
      return {
        ok: false,
        error: message,
        integration: safeIntegrationResponse(updated)
      };
    }
  });

  app.post("/v1/admin/projects/:projectId/handoffs/:handoffId/retry", async (request) => {
    const params = request.params as { projectId: string; handoffId: string };
    const { project, identity } = await authenticateAdminProjectIdentity(
      request,
      repository,
      config
    );
    const handoffSession = await repository.findHandoffSession({
      projectId: project.id,
      id: params.handoffId
    });
    if (!handoffSession) {
      throw notFound("Handoff session not found");
    }
    if (handoffSession.provider !== "chatwoot") {
      throw invalidRequest("Only Chatwoot handoff sessions can be retried");
    }

    const retriedSession = await retryChatwootHandoff({
      repository,
      eventHub,
      config,
      chatwootFetch: options.chatwootFetch,
      handoffSession
    });
    await recordAudit(repository, request, {
      project,
      identity,
      action: "handoff.retried",
      targetType: "handoff_session",
      targetId: handoffSession.id,
      metadata: {
        provider: handoffSession.provider,
        status: retriedSession.status
      }
    });
    return {
      handoff_session: retriedSession,
      status: clientHandoffStatus(retriedSession)
    };
  });

  app.post("/v1/webhooks/chatwoot/:projectId", async (request) => {
    const params = request.params as { projectId: string };
    const payload = chatwootWebhookBodySchema.parse(request.body);
    const integration = await repository.getIntegrationConfig(params.projectId, "chatwoot");
    if (!integration) {
      throw notFound("Chatwoot integration not configured");
    }

    const configPayload = decryptJson(integration.configEncrypted, config.encryptionKey);
    verifyWebhookSecret(request, configPayload);

    const externalEventId = externalEventIdFromPayload(payload);
    const webhookEvent = await repository.createWebhookEvent({
      projectId: params.projectId,
      provider: "chatwoot",
      externalEventId,
      payload
    });
    if (webhookEvent.status === "processed") {
      return { status: "duplicate" };
    }

    const statusChange = chatwootStatusChangeFromPayload(payload);
    if (statusChange.accepted) {
      const result = await processChatwootStatusChange({
        repository,
        eventHub,
        projectId: params.projectId,
        webhookEventId: webhookEvent.id,
        statusChange
      });
      return result;
    }

    const humanMessage = chatwootHumanMessageFromPayload(payload);
    if (!humanMessage.accepted) {
      await repository.markWebhookEvent({
        id: webhookEvent.id,
        status: "ignored"
      });
      return { status: "ignored" };
    }

    const conversationId =
      humanMessage.localConversationId ??
      (humanMessage.externalConversationId
        ? (
            await repository.findHandoffByExternalConversation({
              projectId: params.projectId,
              provider: "chatwoot",
              externalConversationId: humanMessage.externalConversationId
            })
          )?.conversationId
        : undefined);

    if (!conversationId) {
      await repository.markWebhookEvent({
        id: webhookEvent.id,
        status: "ignored",
        error: "No local conversation reference"
      });
      return { status: "ignored" };
    }

    const conversation = await repository.findConversation(params.projectId, conversationId);
    if (!conversation) {
      await repository.markWebhookEvent({
        id: webhookEvent.id,
        status: "ignored",
        error: "Conversation not found"
      });
      return { status: "ignored" };
    }

    const message = await repository.createMessage({
      projectId: params.projectId,
      conversationId: conversation.id,
      message: {
        role: "human_agent",
        text: humanMessage.text,
        metadata: {
          provider: "chatwoot",
          external_conversation_id: humanMessage.externalConversationId,
          external_message_id: humanMessage.externalMessageId
        }
      }
    });

    eventHub.publish(params.projectId, conversation.id, {
      event: "human.message.created",
      data: { message }
    });

    await repository.markWebhookEvent({
      id: webhookEvent.id,
      status: "processed"
    });

    return { status: "ok" };
  });

  return app;
}

async function requestHandoffWithConfiguredProvider(input: {
  repository: SupportRepository;
  eventHub: EventHub;
  config: ApiConfig;
  chatwootFetch?: typeof fetch;
  projectId: string;
  conversationId: string;
  reason: HandoffReason;
  note?: string;
}): Promise<HandoffSessionRecord> {
  const handoffSession = await requestHandoff(
    input.repository,
    input.eventHub,
    input.projectId,
    input.conversationId,
    input.reason,
    input.note
  );

  const integration = await input.repository.getIntegrationConfig(input.projectId, "chatwoot");
  if (!integration || integration.status !== "active") {
    return handoffSession;
  }

  return completeChatwootHandoff({
    ...input,
    handoffSession,
    integration
  });
}

async function retryChatwootHandoff(input: {
  repository: SupportRepository;
  eventHub: EventHub;
  config: ApiConfig;
  chatwootFetch?: typeof fetch;
  handoffSession: HandoffSessionRecord;
}): Promise<HandoffSessionRecord> {
  if (input.handoffSession.status === "active" || input.handoffSession.status === "closed") {
    return input.handoffSession;
  }

  const integration = await input.repository.getIntegrationConfig(
    input.handoffSession.projectId,
    "chatwoot"
  );
  if (!integration || integration.status !== "active") {
    throw invalidRequest("Active Chatwoot integration is required before retrying handoff");
  }

  const retryCount = numberFromMetadata(input.handoffSession.metadata, "retry_count") + 1;
  const handoffSession = await input.repository.updateHandoffSession({
    id: input.handoffSession.id,
    status: "requested",
    metadata: {
      ...input.handoffSession.metadata,
      retry_count: retryCount,
      last_retry_at: new Date().toISOString()
    }
  });

  return completeChatwootHandoff({
    repository: input.repository,
    eventHub: input.eventHub,
    config: input.config,
    chatwootFetch: input.chatwootFetch,
    projectId: handoffSession.projectId,
    conversationId: handoffSession.conversationId,
    reason: handoffSession.reason ?? "user_requested",
    handoffSession,
    integration
  });
}

async function completeChatwootHandoff(input: {
  repository: SupportRepository;
  eventHub: EventHub;
  config: ApiConfig;
  chatwootFetch?: typeof fetch;
  projectId: string;
  conversationId: string;
  reason: HandoffReason;
  note?: string;
  handoffSession: HandoffSessionRecord;
  integration: IntegrationConfigRecord;
}): Promise<HandoffSessionRecord> {
  let externalContactId: string | undefined;
  let externalContactSourceId: string | undefined;
  let externalConversationId: string | undefined;

  try {
    const conversation = await input.repository.findConversation(
      input.projectId,
      input.conversationId
    );
    if (!conversation) {
      throw new Error("Conversation not found during Chatwoot handoff");
    }

    const contact = await input.repository.findContact(input.projectId, conversation.contactId);
    if (!contact) {
      throw new Error("Contact not found during Chatwoot handoff");
    }

    const messages = await input.repository.listMessages(input.projectId, conversation.id);
    const adapter = createChatwootAdapter(
      chatwootAdapterConfig(
        decryptJson(input.integration.configEncrypted, input.config.encryptionKey),
        input.chatwootFetch
      )
    );

    const externalContact = input.handoffSession.externalContactId
      ? {
          provider: "chatwoot" as const,
          externalContactId: input.handoffSession.externalContactId,
          externalContactSourceId: metadataString(
            input.handoffSession.metadata,
            "external_contact_source_id"
          )
        }
      : await adapter.createOrUpdateContact({
          projectId: input.projectId,
          contactId: contact.id,
          name: contact.name,
          email: contact.email,
          externalUserId: contact.externalUserId
        });
    externalContactId = externalContact.externalContactId;
    externalContactSourceId = externalContact.externalContactSourceId;
    const externalConversation = input.handoffSession.externalConversationId
      ? {
          provider: "chatwoot" as const,
          externalConversationId: input.handoffSession.externalConversationId
        }
      : await adapter.createConversation({
          projectId: input.projectId,
          conversationId: conversation.id,
          externalContactId: externalContact.externalContactId,
          externalContactSourceId: externalContact.externalContactSourceId
        });
    externalConversationId = externalConversation.externalConversationId;

    const transcriptMessages = [
      {
        role: "system" as const,
        text: buildHandoffSummary({
          conversation,
          contact,
          messages,
          reason: input.reason,
          note: input.note
        })
      },
      ...chatwootTranscriptMessages(messages)
    ];

    for (const message of transcriptMessages) {
      await adapter.pushMessage({
        projectId: input.projectId,
        externalConversationId: externalConversation.externalConversationId,
        message
      });
    }

    const updatedSession = await input.repository.updateHandoffSession({
      id: input.handoffSession.id,
      status: "active",
      externalContactId: externalContact.externalContactId,
      externalConversationId: externalConversation.externalConversationId,
      metadata: {
        ...input.handoffSession.metadata,
        ...(externalContact.externalContactSourceId
          ? { external_contact_source_id: externalContact.externalContactSourceId }
          : {}),
        handed_off_at: new Date().toISOString()
      }
    });
    const updatedConversation = await input.repository.updateConversationStatus({
      projectId: input.projectId,
      conversationId: conversation.id,
      status: "handed_off",
      assigneeType: "human"
    });
    publishConversationStatus(
      input.eventHub,
      input.projectId,
      conversation.id,
      updatedConversation.status
    );

    return updatedSession;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Chatwoot handoff error";
    const failedSession = await input.repository.updateHandoffSession({
      id: input.handoffSession.id,
      status: "failed",
      externalContactId,
      externalConversationId,
      metadata: {
        ...input.handoffSession.metadata,
        ...(externalContactSourceId ? { external_contact_source_id: externalContactSourceId } : {}),
        error: message,
        failed_at: new Date().toISOString()
      }
    });

    input.eventHub.publish(input.projectId, input.conversationId, {
      event: "error",
      data: {
        code: "chatwoot_handoff_failed",
        message: "Human handoff could not be created in Chatwoot. Please try again later."
      }
    });

    return failedSession;
  }
}

function createLlmGroundedAnswerGenerator(
  config: ApiConfig,
  fetchImpl?: typeof fetch
): GroundedAnswerGenerator {
  return async ({ userText, chunks, provider }) => {
    if (!provider) {
      throw new Error("LLM provider is required");
    }

    const client = new OpenAICompatibleClient({
      baseUrl: provider.baseUrl,
      apiKey: llmApiKey(provider, config),
      model: provider.model,
      embeddingModel: provider.embeddingModel,
      timeoutMs: 45_000,
      fetchImpl
    });
    const response = await client.generate({
      model: provider.model,
      temperature: 0.2,
      messages: groundedAnswerMessages(userText, chunks)
    });

    return {
      answer: response.text,
      provider: provider.provider,
      model: response.model,
      promptVersion: "v0.6",
      inputTokens: response.usage?.promptTokens,
      outputTokens: response.usage?.completionTokens,
      confidence: Math.min(1, 0.6 + chunks.length * 0.08),
      metadata: {
        generated_by: "openai_compatible_grounded_answer_v0.6",
        llm_base_url: provider.baseUrl,
        embedding_model: provider.embeddingModel
      }
    };
  };
}

function groundedAnswerMessages(
  userText: string,
  chunks: KnowledgeChunkRecord[]
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You are OpenSupportAI, a support assistant embedded in a product.",
        "Answer only from the provided knowledge snippets.",
        "If the snippets do not answer the question, say you cannot confirm from the current knowledge base and suggest human handoff.",
        "Keep the answer concise, practical, and in the same language as the customer."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Customer question:\n${userText}`,
        "Knowledge snippets:",
        chunks
          .map((chunk, index) => {
            const title =
              typeof chunk.metadata["title"] === "string" ? ` (${chunk.metadata["title"]})` : "";
            return `[${index + 1}]${title}\n${chunk.content}`;
          })
          .join("\n\n")
      ].join("\n\n")
    }
  ];
}

function llmApiKey(provider: LlmProviderRecord, config: ApiConfig): string {
  if (provider.apiKeyEncrypted.startsWith("v1.")) {
    return requiredConfigString(
      decryptJson(provider.apiKeyEncrypted, config.encryptionKey),
      "api_key"
    );
  }
  if (provider.baseUrl === "demo://local") {
    return provider.apiKeyEncrypted;
  }
  throw new Error("Unsupported LLM API key format");
}

function chatwootAdapterConfig(
  configPayload: JsonRecord,
  fetchImpl?: typeof fetch
): ChatwootAdapterConfig {
  const adapterConfig: ChatwootAdapterConfig = {
    baseUrl: requiredConfigString(configPayload, "base_url"),
    accountId: requiredConfigString(configPayload, "account_id"),
    inboxId: requiredConfigString(configPayload, "inbox_id"),
    apiAccessToken: requiredConfigString(configPayload, "api_access_token")
  };
  return fetchImpl ? { ...adapterConfig, fetchImpl } : adapterConfig;
}

function genericWebhookAdapterConfig(configPayload: JsonRecord): GenericWebhookAdapterConfig {
  return {
    webhookSecret: requiredConfigString(configPayload, "webhook_secret"),
    secretHeader: stringValue(configPayload["secret_header"]) ?? "x-opensupportai-webhook-secret"
  };
}

function slackAdapterConfig(configPayload: JsonRecord): SlackAdapterConfig {
  return {
    signingSecret: requiredConfigString(configPayload, "signing_secret"),
    defaultChannelId: stringValue(configPayload["default_channel_id"]),
    defaultInboxId: stringValue(configPayload["default_inbox_id"]) ?? "inbox_default"
  };
}

function isSlackSignatureError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("Slack signature") ||
    error.message.includes("x-slack-signature") ||
    error.message.includes("signing_secret")
  );
}

function idempotentWebhookResponse(
  event: WebhookEventRecord,
  provider: ChannelProvider
):
  | {
      status: "processed" | "ignored";
      provider: ChannelProvider;
      webhook_event_id: string;
      idempotent: true;
    }
  | undefined {
  if (event.status !== "processed" && event.status !== "ignored") {
    return undefined;
  }

  return {
    status: event.status,
    provider,
    webhook_event_id: event.id,
    idempotent: true
  };
}

function safeIntegrationResponse(integration: IntegrationConfigRecord): {
  id: string;
  projectId: string;
  provider: string;
  status: IntegrationConfigRecord["status"];
  metadata: JsonRecord;
  configured: true;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: integration.id,
    projectId: integration.projectId,
    provider: integration.provider,
    status: integration.status,
    metadata: integration.metadata,
    configured: true,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt
  };
}

function safeApiKeyResponse(apiKey: ApiKeyRecord): Omit<ApiKeyRecord, "keyHash"> {
  const { keyHash: _keyHash, ...safeApiKey } = apiKey;
  return safeApiKey;
}

function generateApiKeySecret(): string {
  return `osa_sk_${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 16)}`;
}

function requireRootAdmin(identity: AdminIdentity): void {
  if (identity.actorType !== "root_admin") {
    throw forbidden("Only the root admin token can perform this operation");
  }
}

function requireAdminScope(identity: AdminIdentity, scope: string): void {
  if (
    identity.actorType === "root_admin" ||
    identity.scopes.includes("admin:*") ||
    identity.scopes.includes(scope)
  ) {
    return;
  }

  throw forbidden(`Admin API key is missing required scope: ${scope}`);
}

async function recordAudit(
  repository: SupportRepository,
  request: FastifyRequest,
  input: {
    project: ProjectRecord;
    identity: AdminIdentity;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: JsonRecord;
  }
): Promise<void> {
  try {
    await repository.createAuditLog({
      projectId: input.project.id,
      organizationId: input.project.organizationId,
      actorType: input.identity.actorType,
      actorId: input.identity.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      requestId: request.id
    });
  } catch (error) {
    request.log.warn({ err: error }, "Failed to write audit log");
  }
}

async function buildOpsHealth(
  repository: SupportRepository,
  project: ProjectRecord,
  config: ApiConfig
): Promise<{
  status: "ok";
  generated_at: string;
  project: Pick<ProjectRecord, "id" | "name" | "defaultLocale">;
  storage: { mode: ApiConfig["storageMode"] };
  checks: {
    repository: "ok";
    llm_provider_configured: boolean;
    chatwoot: { configured: boolean; status?: IntegrationConfigRecord["status"] };
  };
  counts: {
    conversations: Record<string, number>;
    recent_async_jobs: Record<string, number>;
    recent_webhook_events: Record<string, number>;
    tools: Record<string, number>;
    recent_tool_calls: Record<string, number>;
  };
  latest_audit_log?: AuditLogRecord;
}> {
  const [
    conversations,
    llmProvider,
    chatwootIntegration,
    jobs,
    webhookEvents,
    tools,
    toolCalls,
    auditLogs
  ] = await Promise.all([
    repository.listConversations(project.id),
    repository.getActiveLlmProvider(project.id),
    repository.getIntegrationConfig(project.id, "chatwoot"),
    repository.listAsyncJobs({ projectId: project.id, limit: 100 }),
    repository.listWebhookEvents({ projectId: project.id, limit: 100 }),
    repository.listToolDefinitions({ projectId: project.id, limit: 100 }),
    repository.listToolCalls({ projectId: project.id, limit: 100 }),
    repository.listAuditLogs({ projectId: project.id, limit: 1 })
  ]);

  return {
    status: "ok",
    generated_at: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      defaultLocale: project.defaultLocale
    },
    storage: {
      mode: config.storageMode
    },
    checks: {
      repository: "ok",
      llm_provider_configured: Boolean(llmProvider),
      chatwoot: {
        configured: Boolean(chatwootIntegration),
        status: chatwootIntegration?.status
      }
    },
    counts: {
      conversations: countBy(conversations, (conversation) => conversation.status),
      recent_async_jobs: countBy(jobs, (job) => job.status),
      recent_webhook_events: countBy(webhookEvents, (event) => event.status),
      tools: countBy(tools, (tool) => tool.status),
      recent_tool_calls: countBy(toolCalls, (toolCall) => toolCall.status)
    },
    latest_audit_log: auditLogs[0]
  };
}

function countBy<T>(items: T[], keyForItem: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

type RateLimitBucket = {
  windowStart: number;
  count: number;
};

function registerRateLimit(app: FastifyInstance, config: ApiConfig): void {
  const enabled = config.rateLimitEnabled ?? config.nodeEnv !== "test";
  if (!enabled) {
    return;
  }

  const windowMs = positiveNumber(config.rateLimitWindowMs, 60_000);
  const max = positiveNumber(config.rateLimitMax, 120);
  const buckets = new Map<string, RateLimitBucket>();

  app.addHook("onRequest", async (request, reply) => {
    if (isRateLimitExempt(request.url)) {
      return;
    }

    const now = Date.now();
    const key = rateLimitKey(request);
    const existing = buckets.get(key);
    const bucket =
      existing && now - existing.windowStart < windowMs
        ? existing
        : {
            windowStart: now,
            count: 0
          };
    bucket.count += 1;
    buckets.set(key, bucket);

    const resetMs = Math.max(0, bucket.windowStart + windowMs - now);
    reply.header("x-ratelimit-limit", String(max));
    reply.header("x-ratelimit-remaining", String(Math.max(0, max - bucket.count)));
    reply.header("x-ratelimit-reset-ms", String(resetMs));

    if (bucket.count > max) {
      throw rateLimited(`Rate limit exceeded. Try again in ${Math.ceil(resetMs / 1000)} seconds.`);
    }

    if (buckets.size > 10_000) {
      pruneRateLimitBuckets(buckets, now, windowMs);
    }
  });
}

function isRateLimitExempt(url: string): boolean {
  return url === "/health" || url === "/v1/health";
}

function rateLimitKey(request: FastifyRequest): string {
  const adminToken = headerValue(request, "authorization");
  if (adminToken) {
    return `admin:${hashSecret(adminToken)}`;
  }

  const publicKey = headerValue(request, "x-opensupportai-public-key");
  if (publicKey) {
    return `client:${hashSecret(publicKey)}`;
  }

  const webhookSignature = headerValue(request, "x-opensupportai-signature");
  if (webhookSignature) {
    return `webhook:${hashSecret(webhookSignature)}`;
  }

  return `ip:${request.ip}`;
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? value : fallback;
}

function pruneRateLimitBuckets(
  buckets: Map<string, RateLimitBucket>,
  now: number,
  windowMs: number
): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

type ListConversationsQuery = {
  status?: ConversationStatus;
  assignee_type?: ConversationRecord["assigneeType"];
  q?: string;
  limit: number;
  offset: number;
};

type AdminConversationListItem = ConversationRecord & {
  contact?: {
    id: string;
    name?: string;
    email?: string;
    externalUserId?: string;
  };
  messageCount: number;
  lastMessage?: {
    id: string;
    role: MessageRecord["role"];
    text: string;
    createdAt: string;
  };
  handoff?: {
    id: string;
    provider: string;
    status: HandoffSessionRecord["status"];
    externalConversationId?: string;
    updatedAt: string;
  };
  channel?: ChannelConversationSummary;
};

type ChannelConversationSummary = {
  provider: string;
  externalConversationId?: string;
  externalEventId?: string;
  externalUserId?: string;
  source?: string;
  receivedAt?: string;
};

async function buildAdminConversationList(
  repository: SupportRepository,
  projectId: string,
  query: ListConversationsQuery
): Promise<{
  conversations: AdminConversationListItem[];
  summary: {
    total: number;
    filtered: number;
    byStatus: Record<ConversationStatus, number>;
    byAssigneeType: Record<ConversationRecord["assigneeType"], number>;
    handoffStatus: Record<HandoffSessionRecord["status"], number>;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    hasMore: boolean;
  };
}> {
  const conversations = await repository.listConversations(projectId);
  const enriched = await Promise.all(
    conversations.map((conversation) =>
      buildAdminConversationListItem(repository, projectId, conversation)
    )
  );
  const filtered = enriched.filter((conversation) =>
    matchesAdminConversationQuery(conversation, query)
  );
  const page = filtered.slice(query.offset, query.offset + query.limit);

  return {
    conversations: page,
    summary: {
      total: enriched.length,
      filtered: filtered.length,
      byStatus: countConversationStatuses(enriched),
      byAssigneeType: countAssigneeTypes(enriched),
      handoffStatus: countHandoffStatuses(enriched)
    },
    pagination: {
      limit: query.limit,
      offset: query.offset,
      returned: page.length,
      hasMore: query.offset + page.length < filtered.length
    }
  };
}

async function buildAdminConversationListItem(
  repository: SupportRepository,
  projectId: string,
  conversation: ConversationRecord
): Promise<AdminConversationListItem> {
  const [contact, messages, handoffSessions] = await Promise.all([
    repository.findContact(projectId, conversation.contactId),
    repository.listMessages(projectId, conversation.id),
    repository.listHandoffSessions({ projectId, conversationId: conversation.id })
  ]);
  const lastMessage = messages.at(-1);
  const latestHandoff = [...handoffSessions].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )[0];

  return {
    ...conversation,
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          externalUserId: contact.externalUserId
        }
      : undefined,
    messageCount: messages.length,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          role: lastMessage.role,
          text: truncate(textFromMessage(lastMessage), 240),
          createdAt: lastMessage.createdAt
        }
      : undefined,
    handoff: latestHandoff
      ? {
          id: latestHandoff.id,
          provider: latestHandoff.provider,
          status: latestHandoff.status,
          externalConversationId: latestHandoff.externalConversationId,
          updatedAt: latestHandoff.updatedAt
        }
      : undefined,
    channel: channelSummaryFromMetadata(conversation.metadata)
  };
}

function matchesAdminConversationQuery(
  conversation: AdminConversationListItem,
  query: ListConversationsQuery
): boolean {
  if (query.status && conversation.status !== query.status) {
    return false;
  }
  if (query.assignee_type && conversation.assigneeType !== query.assignee_type) {
    return false;
  }

  const term = query.q?.trim().toLowerCase();
  if (!term) {
    return true;
  }

  return [
    conversation.id,
    conversation.status,
    conversation.assigneeType,
    conversation.contact?.name,
    conversation.contact?.email,
    conversation.contact?.externalUserId,
    conversation.lastMessage?.text,
    conversation.channel?.provider,
    conversation.channel?.externalConversationId,
    conversation.channel?.externalUserId,
    conversation.channel?.source,
    conversation.handoff?.provider,
    conversation.handoff?.status,
    conversation.handoff?.externalConversationId
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(term));
}

function countConversationStatuses(
  conversations: AdminConversationListItem[]
): Record<ConversationStatus, number> {
  const counts: Record<ConversationStatus, number> = {
    open: 0,
    pending_ai: 0,
    handoff_requested: 0,
    handed_off: 0,
    closed: 0
  };
  for (const conversation of conversations) {
    counts[conversation.status] += 1;
  }
  return counts;
}

function countAssigneeTypes(
  conversations: AdminConversationListItem[]
): Record<ConversationRecord["assigneeType"], number> {
  const counts: Record<ConversationRecord["assigneeType"], number> = {
    ai: 0,
    human: 0,
    none: 0
  };
  for (const conversation of conversations) {
    counts[conversation.assigneeType] += 1;
  }
  return counts;
}

function countHandoffStatuses(
  conversations: AdminConversationListItem[]
): Record<HandoffSessionRecord["status"], number> {
  const counts: Record<HandoffSessionRecord["status"], number> = {
    requested: 0,
    active: 0,
    closed: 0,
    failed: 0
  };
  for (const conversation of conversations) {
    if (conversation.handoff) {
      counts[conversation.handoff.status] += 1;
    }
  }
  return counts;
}

function requiredConfigString(configPayload: JsonRecord, key: string): string {
  const value = configPayload[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Chatwoot integration config is missing ${key}`);
  }
  return value;
}

function clientHandoffStatus(
  handoffSession: HandoffSessionRecord
): "handoff_requested" | "handed_off" {
  return handoffSession.status === "active" ? "handed_off" : "handoff_requested";
}

function buildHandoffSummary(input: {
  conversation: ConversationRecord;
  contact: ContactRecord;
  messages: MessageRecord[];
  reason: HandoffReason;
  note?: string;
}): string {
  const lines = [
    "OpenSupportAI handoff summary",
    `Reason: ${input.reason}`,
    `Local conversation: ${input.conversation.id}`,
    `Local contact: ${input.contact.id}`
  ];

  if (input.contact.name) {
    lines.push(`Name: ${input.contact.name}`);
  }
  if (input.contact.email) {
    lines.push(`Email: ${input.contact.email}`);
  }
  if (input.contact.externalUserId) {
    lines.push(`External user ID: ${input.contact.externalUserId}`);
  }
  if (input.note) {
    lines.push(`Note: ${input.note}`);
  }

  const pageUrl = metadataString(input.conversation.metadata, "page_url");
  if (pageUrl) {
    lines.push(`Page URL: ${pageUrl}`);
  }

  const recentMessages = input.messages
    .filter((message) => message.visibility === "public")
    .slice(-8);
  if (recentMessages.length > 0) {
    lines.push("", "Recent public messages:");
    for (const message of recentMessages) {
      lines.push(`${messageRoleLabel(message.role)}: ${truncate(textFromMessage(message), 300)}`);
    }
  }

  return lines.join("\n");
}

function chatwootTranscriptMessages(
  messages: MessageRecord[]
): Array<{ role: "end_user" | "ai_agent" | "system"; text: string }> {
  return messages
    .filter((message) => message.visibility === "public")
    .slice(-30)
    .flatMap((message) => {
      const text = textFromMessage(message).trim();
      if (!text) {
        return [];
      }

      if (message.role === "end_user" || message.role === "ai_agent" || message.role === "system") {
        return [
          {
            role: message.role,
            text
          }
        ];
      }

      return [];
    });
}

function publishConversationStatus(
  eventHub: EventHub,
  projectId: string,
  conversationId: string,
  status: ConversationStatus
): void {
  eventHub.publish(projectId, conversationId, {
    event: "conversation.status_changed",
    data: {
      conversationId,
      status
    }
  });
}

type ChatwootStatusChange = {
  accepted: true;
  externalConversationId?: string;
  localConversationId?: string;
  chatwootStatus: string;
  localStatus: "handed_off" | "closed";
  handoffStatus: "active" | "closed";
};

type IgnoredChatwootStatusChange = {
  accepted: false;
};

async function processChatwootStatusChange(input: {
  repository: SupportRepository;
  eventHub: EventHub;
  projectId: string;
  webhookEventId: string;
  statusChange: ChatwootStatusChange;
}): Promise<{ status: "ok" | "ignored"; conversation_id?: string; conversation_status?: string }> {
  const handoffSession = input.statusChange.externalConversationId
    ? await input.repository.findHandoffByExternalConversation({
        projectId: input.projectId,
        provider: "chatwoot",
        externalConversationId: input.statusChange.externalConversationId
      })
    : undefined;
  const conversationId = input.statusChange.localConversationId ?? handoffSession?.conversationId;

  if (!conversationId) {
    await input.repository.markWebhookEvent({
      id: input.webhookEventId,
      status: "ignored",
      error: "No local conversation reference"
    });
    return { status: "ignored" };
  }

  const conversation = await input.repository.findConversation(input.projectId, conversationId);
  if (!conversation) {
    await input.repository.markWebhookEvent({
      id: input.webhookEventId,
      status: "ignored",
      error: "Conversation not found"
    });
    return { status: "ignored" };
  }

  const updatedConversation = await input.repository.updateConversationStatus({
    projectId: input.projectId,
    conversationId: conversation.id,
    status: input.statusChange.localStatus,
    assigneeType: input.statusChange.localStatus === "closed" ? "none" : "human"
  });
  publishConversationStatus(
    input.eventHub,
    input.projectId,
    conversation.id,
    updatedConversation.status
  );

  if (handoffSession) {
    await input.repository.updateHandoffSession({
      id: handoffSession.id,
      status: input.statusChange.handoffStatus,
      metadata: {
        ...handoffSession.metadata,
        chatwoot_status: input.statusChange.chatwootStatus,
        status_synced_at: new Date().toISOString()
      }
    });
  }

  await input.repository.markWebhookEvent({
    id: input.webhookEventId,
    status: "processed"
  });

  return {
    status: "ok",
    conversation_id: conversation.id,
    conversation_status: updatedConversation.status
  };
}

function chatwootStatusChangeFromPayload(
  payload: JsonRecord
): ChatwootStatusChange | IgnoredChatwootStatusChange {
  const event = stringValue(payload["event"]);
  if (event !== "conversation_status_changed") {
    return { accepted: false };
  }

  const chatwootStatus =
    stringValue(payload["status"]) ?? stringValue(nested(payload, "conversation", "status"));
  const localStatus = chatwootStatus ? chatwootStatusToLocalStatus(chatwootStatus) : undefined;
  if (!chatwootStatus || !localStatus) {
    return { accepted: false };
  }

  return {
    accepted: true,
    chatwootStatus,
    localStatus,
    handoffStatus: localStatus === "closed" ? "closed" : "active",
    localConversationId:
      stringValue(
        nested(payload, "conversation", "custom_attributes", "opensupportai_conversation_id")
      ) ?? stringValue(nested(payload, "custom_attributes", "opensupportai_conversation_id")),
    externalConversationId:
      stringValue(payload["conversation_id"]) ??
      stringValue(nested(payload, "conversation", "id")) ??
      stringValue(payload["id"])
  };
}

function chatwootStatusToLocalStatus(status: string): "handed_off" | "closed" | undefined {
  if (status === "resolved") {
    return "closed";
  }
  if (status === "open" || status === "pending" || status === "snoozed") {
    return "handed_off";
  }
  return undefined;
}

function channelProviderFromParam(
  provider: string
): "generic_webhook" | "slack" | StubChannelProvider | undefined {
  if (provider === "generic_webhook" || provider === "slack" || provider === "email") {
    return provider;
  }
  if (provider === "telegram") {
    return provider;
  }
  return undefined;
}

function normalizeRequestHeaders(request: FastifyRequest): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value[0] : value
    ])
  );
}

async function findOrCreateChannelConversation(
  repository: SupportRepository,
  input: {
    project: ProjectRecord;
    inbox: InboxRecord;
    normalized: NormalizedInboundChannelMessage;
  }
): Promise<ConversationRecord> {
  const localConversationId = input.normalized.localConversationId;
  if (localConversationId) {
    const existing = await repository.findConversation(input.project.id, localConversationId);
    if (existing) {
      return existing;
    }
  }

  const externalConversationId = input.normalized.externalConversationId;
  if (externalConversationId) {
    const existing = (await repository.listConversations(input.project.id)).find((conversation) =>
      conversationMatchesChannel(conversation, input.normalized.provider, externalConversationId)
    );
    if (existing) {
      return existing;
    }
  }

  const contact = await repository.upsertContact(input.project.id, {
    externalUserId:
      input.normalized.contact.externalUserId ??
      input.normalized.externalConversationId ??
      input.normalized.externalEventId,
    name: input.normalized.contact.name,
    email: input.normalized.contact.email,
    metadata: {
      channel: channelMessageMetadata(input.normalized)
    }
  });

  return repository.createConversation({
    projectId: input.project.id,
    inboxId: input.inbox.id,
    contactId: contact.id,
    metadata: {
      ...input.normalized.metadata,
      channel: {
        ...channelMessageMetadata(input.normalized),
        inboxId: input.inbox.id
      }
    }
  });
}

function conversationMatchesChannel(
  conversation: ConversationRecord,
  provider: ChannelProvider,
  externalConversationId: string
): boolean {
  const channel = recordValue(conversation.metadata["channel"]);
  return (
    stringValue(channel?.["provider"]) === provider &&
    stringValue(channel?.["externalConversationId"]) === externalConversationId
  );
}

function channelMessageMetadata(
  normalized: NormalizedInboundChannelMessage
): Record<string, unknown> {
  return {
    provider: normalized.provider,
    externalEventId: normalized.externalEventId,
    externalConversationId: normalized.externalConversationId,
    externalUserId: normalized.contact.externalUserId,
    receivedAt: normalized.receivedAt
  };
}

function channelSummaryFromMetadata(metadata: JsonRecord): ChannelConversationSummary | undefined {
  const channel = recordValue(metadata["channel"]);
  if (!channel) {
    return undefined;
  }

  const provider = stringValue(channel["provider"]);
  if (!provider) {
    return undefined;
  }

  return {
    provider,
    externalConversationId: stringValue(channel["externalConversationId"]),
    externalEventId: stringValue(channel["externalEventId"]),
    externalUserId: stringValue(channel["externalUserId"]),
    source: stringValue(metadata["source"]) ?? stringValue(channel["source"]),
    receivedAt: stringValue(channel["receivedAt"])
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function metadataString(metadata: JsonRecord, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function numberFromMetadata(metadata: JsonRecord, key: string): number {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textFromMessage(message: MessageRecord): string {
  const text = message.content["text"];
  return typeof text === "string" ? text : "";
}

function messageRoleLabel(role: MessageRecord["role"]): string {
  if (role === "end_user") {
    return "User";
  }
  if (role === "ai_agent") {
    return "AI";
  }
  if (role === "human_agent") {
    return "Agent";
  }
  return "System";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

async function authenticateAdminProject(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig
): Promise<string> {
  return (await authenticateAdminProjectIdentity(request, repository, config)).project.id;
}

async function authenticateAdminProjectIdentity(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig
): Promise<{ project: ProjectRecord; identity: AdminIdentity }> {
  const params = request.params as { projectId: string };
  const identity = await authenticateAdminIdentity(request, repository, config);
  if (identity.project && identity.project.id !== params.projectId) {
    throw unauthorized("Admin token cannot access this project");
  }
  const project = await repository.findProjectById(params.projectId);
  if (!project) {
    throw notFound("Project not found");
  }
  return { project, identity };
}

function writeSseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
}

function verifyWebhookSecret(request: FastifyRequest, configPayload: JsonRecord): void {
  const secret = configPayload["webhook_secret"];
  if (typeof secret !== "string") {
    throw unauthorized("Webhook secret is not configured");
  }

  const signatureHeader = request.headers["x-opensupportai-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (signature !== secret && signature !== `sha256=${hashSecret(secret)}`) {
    throw unauthorized("Invalid webhook signature");
  }
}

function externalEventIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const id = payload["id"] ?? payload["event_id"] ?? payload["message_id"];
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : `payload_${hashSecret(JSON.stringify(payload))}`;
}

type ChatwootHumanMessage = {
  accepted: true;
  text: string;
  localConversationId?: string;
  externalConversationId?: string;
  externalMessageId?: string;
};

type IgnoredChatwootMessage = {
  accepted: false;
};

function chatwootHumanMessageFromPayload(
  payload: JsonRecord
): ChatwootHumanMessage | IgnoredChatwootMessage {
  const content =
    stringValue(payload["content"]) ?? stringValue(nested(payload, "message", "content"));
  if (!content?.trim()) {
    return { accepted: false };
  }

  const messageType = payload["message_type"];
  const isOutgoing = messageType === "outgoing" || messageType === 1 || messageType === "1";
  if (!isOutgoing || payload["private"] === true) {
    return { accepted: false };
  }

  return {
    accepted: true,
    text: content,
    localConversationId:
      stringValue(
        nested(payload, "conversation", "custom_attributes", "opensupportai_conversation_id")
      ) ?? stringValue(nested(payload, "custom_attributes", "opensupportai_conversation_id")),
    externalConversationId:
      stringValue(payload["conversation_id"]) ?? stringValue(nested(payload, "conversation", "id")),
    externalMessageId:
      stringValue(payload["id"]) ??
      stringValue(payload["message_id"]) ??
      stringValue(nested(payload, "message", "id"))
  };
}

function nested(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}
