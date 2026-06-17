import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { authenticateAdmin, authenticateClient } from "./auth";
import { type ApiConfig, loadConfig } from "./config";
import { decryptJson, encryptJson, hashSecret } from "./crypto";
import { ApiError, invalidRequest, notFound, toApiErrorResponse, unauthorized } from "./errors";
import { EventHub, formatSse } from "./event-hub";
import { createOrchestrator, requestHandoff } from "./orchestrator";
import { MemorySupportRepository } from "./repositories/memory";
import { PrismaSupportRepository } from "./repositories/prisma";
import type { JsonRecord, SupportRepository } from "./repositories/types";
import {
  chatwootWebhookBodySchema,
  createConversationBodySchema,
  createKnowledgeDocumentBodySchema,
  createProjectBodySchema,
  requestHandoffBodySchema,
  sendMessageBodySchema,
  upsertChatwootIntegrationBodySchema,
  upsertLlmProviderBodySchema
} from "./schemas";

export type BuildAppOptions = {
  config?: ApiConfig;
  repository?: SupportRepository;
  eventHub?: EventHub;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const repository =
    options.repository ??
    (config.storageMode === "memory"
      ? new MemorySupportRepository()
      : new PrismaSupportRepository());
  const eventHub = options.eventHub ?? new EventHub();
  const orchestrator = createOrchestrator(repository, eventHub);
  await repository.seedDemo();

  const app = Fastify({
    logger: config.nodeEnv !== "test",
    genReqId: () => `req_${crypto.randomUUID()}`
  });

  await app.register(cors, {
    origin: config.corsOrigin
  });

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

    await requestHandoff(repository, eventHub, project.id, conversation.id, body.reason, body.note);
    return {
      conversation_id: conversation.id,
      status: "handoff_requested"
    };
  });

  app.get("/v1/admin/projects", async (request) => {
    await authenticateAdmin(request, repository, config);
    return {
      projects: await repository.listProjects()
    };
  });

  app.post("/v1/admin/projects", async (request) => {
    await authenticateAdmin(request, repository, config);
    const body = createProjectBodySchema.parse(request.body);
    const project = await repository.createProject({
      name: body.name,
      defaultLocale: body.default_locale
    });
    return { project };
  });

  app.get("/v1/admin/projects/:projectId/conversations", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    return {
      conversations: await repository.listConversations(projectId)
    };
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
      messages: await repository.listMessages(projectId, conversation.id),
      ai_runs: await repository.listAiRuns(projectId, conversation.id)
    };
  });

  app.get("/v1/admin/projects/:projectId/knowledge/documents", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    return {
      documents: await repository.listKnowledgeDocuments(projectId)
    };
  });

  app.post("/v1/admin/projects/:projectId/knowledge/documents", async (request) => {
    const projectId = await authenticateAdminProject(request, repository, config);
    const body = createKnowledgeDocumentBodySchema.parse(request.body);
    const document = await repository.createKnowledgeDocument(projectId, {
      title: body.title,
      sourceType: body.source_type,
      content: body.content,
      sourceUri: body.source_uri,
      metadata: body.metadata
    });
    return { document };
  });

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
    const projectId = await authenticateAdminProject(request, repository, config);
    const body = upsertLlmProviderBodySchema.parse(request.body);
    const provider = await repository.upsertLlmProvider({
      projectId,
      provider: body.provider,
      baseUrl: body.base_url,
      model: body.model,
      embeddingModel: body.embedding_model,
      apiKeyEncrypted: encryptJson({ api_key: body.api_key }, config.encryptionKey),
      status: body.status
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
    const projectId = await authenticateAdminProject(request, repository, config);
    const body = upsertChatwootIntegrationBodySchema.parse(request.body);
    const integration = await repository.upsertIntegrationConfig({
      projectId,
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

async function authenticateAdminProject(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig
): Promise<string> {
  const params = request.params as { projectId: string };
  const adminProject = await authenticateAdmin(request, repository, config);
  if (adminProject && adminProject.id !== params.projectId) {
    throw unauthorized("Admin token cannot access this project");
  }
  const project = await repository.findProjectById(params.projectId);
  if (!project) {
    throw notFound("Project not found");
  }
  return project.id;
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
