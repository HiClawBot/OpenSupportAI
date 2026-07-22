import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { chunkText, scoreChunk, tokenize } from "../knowledge-text";
import { IdempotencyConflictError } from "./types";
import type {
  AdminApiKeyLookup,
  AiRunRecord,
  ApiKeyRecord,
  AsyncJobRecord,
  AsyncJobStatus,
  AuditLogRecord,
  ContactInput,
  ContactRecord,
  ConversationInsightRecord,
  ConversationRecord,
  CreateAiRunInput,
  CreateKnowledgeDocumentInput,
  CreateMessageInput,
  CreateProjectInput,
  HandoffSessionRecord,
  InboxRecord,
  IntegrationConfigRecord,
  JsonRecord,
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  LlmProviderRecord,
  MessageRecord,
  ProjectRecord,
  SupportRepository,
  ToolCallRecord,
  ToolDefinitionRecord,
  WebhookEventRecord
} from "./types";
import type {
  ConversationStatus,
  MessageRole,
  MessageVisibility,
  SourceReference
} from "@opensupportai/protocol";
import { createPrismaClient } from "../prisma-client";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function jsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sourceReferences(value: unknown): SourceReference[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const refs = value.filter((item): item is SourceReference => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const record = item as Record<string, unknown>;
    return typeof record["documentId"] === "string" || typeof record["document_id"] === "string";
  });

  return refs.length > 0 ? refs : undefined;
}

export class PrismaSupportRepository implements SupportRepository {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  async seedDemo(): Promise<void> {
    const organization = await this.prisma.organization.upsert({
      where: { id: "org_demo" },
      update: { name: "Demo Organization" },
      create: { id: "org_demo", name: "Demo Organization" }
    });

    const project = await this.prisma.project.upsert({
      where: { id: "proj_demo" },
      update: { name: "Demo Project", publicKey: "pk_demo" },
      create: {
        id: "proj_demo",
        organizationId: organization.id,
        name: "Demo Project",
        publicKey: "pk_demo",
        defaultLocale: "zh-CN"
      }
    });

    await this.prisma.inbox.upsert({
      where: { id: "inbox_default" },
      update: { name: "Default Inbox", handoffProvider: "chatwoot" },
      create: {
        id: "inbox_default",
        projectId: project.id,
        name: "Default Inbox",
        handoffProvider: "chatwoot"
      }
    });

    await this.prisma.apiKey.upsert({
      where: { keyHash: hash("admin_demo_key") },
      update: { revokedAt: null, scopes: ["admin:*"] },
      create: {
        id: "key_demo_admin",
        organizationId: organization.id,
        projectId: project.id,
        name: "Demo Admin Key",
        keyHash: hash("admin_demo_key"),
        scopes: ["admin:*"]
      }
    });

    await this.seedDemoTools(project.id);
  }

  private async seedDemoTools(projectId: string): Promise<void> {
    for (const tool of demoToolDefinitions(projectId)) {
      await this.prisma.toolDefinition.upsert({
        where: {
          projectId_slug: {
            projectId,
            slug: tool.slug
          }
        },
        update: {
          name: tool.name,
          description: tool.description,
          kind: tool.kind,
          status: tool.status,
          method: tool.method,
          path: tool.path,
          inputSchema: jsonInput(tool.inputSchema),
          outputSchema: jsonInput(tool.outputSchema),
          metadata: jsonInput(tool.metadata)
        },
        create: {
          id: tool.id,
          projectId,
          slug: tool.slug,
          name: tool.name,
          description: tool.description,
          kind: tool.kind,
          status: tool.status,
          method: tool.method,
          path: tool.path,
          inputSchema: jsonInput(tool.inputSchema),
          outputSchema: jsonInput(tool.outputSchema),
          metadata: jsonInput(tool.metadata)
        }
      });
    }
  }

  async findProjectByPublicKey(publicKey: string): Promise<ProjectRecord | undefined> {
    const project = await this.prisma.project.findUnique({ where: { publicKey } });
    return project ? mapProject(project) : undefined;
  }

  async findProjectById(projectId: string): Promise<ProjectRecord | undefined> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId } });
    return project ? mapProject(project) : undefined;
  }

  async findProjectByAdminKeyHash(keyHash: string): Promise<ProjectRecord | undefined> {
    const lookup = await this.findAdminApiKeyByHash(keyHash);
    return lookup?.project;
  }

  async findAdminApiKeyByHash(keyHash: string): Promise<AdminApiKeyLookup | undefined> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
        projectId: { not: null }
      },
      include: {
        project: true
      }
    });
    return apiKey
      ? {
          apiKey: mapApiKey(apiKey),
          project: apiKey.project ? mapProject(apiKey.project) : undefined
        }
      : undefined;
  }

  async touchApiKeyLastUsed(id: string, timestamp?: string): Promise<void> {
    await this.prisma.apiKey.updateMany({
      where: { id },
      data: {
        lastUsedAt: timestamp ? new Date(timestamp) : new Date()
      }
    });
  }

  async createApiKey(input: {
    projectId: string;
    organizationId?: string;
    name: string;
    keyHash: string;
    scopes: string[];
  }): Promise<ApiKeyRecord> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
    const apiKey = await this.prisma.apiKey.create({
      data: {
        id: id("key"),
        projectId: input.projectId,
        organizationId: input.organizationId ?? project.organizationId,
        name: input.name,
        keyHash: input.keyHash,
        scopes: input.scopes
      }
    });
    return mapApiKey(apiKey);
  }

  async listApiKeys(input: {
    projectId: string;
    includeRevoked?: boolean;
  }): Promise<ApiKeyRecord[]> {
    const apiKeys = await this.prisma.apiKey.findMany({
      where: {
        projectId: input.projectId,
        ...(input.includeRevoked ? {} : { revokedAt: null })
      },
      orderBy: { createdAt: "desc" }
    });
    return apiKeys.map(mapApiKey);
  }

  async revokeApiKey(input: { projectId: string; id: string }): Promise<ApiKeyRecord> {
    const apiKeys = await this.prisma.apiKey.updateManyAndReturn({
      where: {
        id: input.id,
        projectId: input.projectId
      },
      data: {
        revokedAt: new Date()
      }
    });
    if (!apiKeys[0]) {
      throw new Error(`API key not found: ${input.id}`);
    }
    return mapApiKey(apiKeys[0]);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const projects = await this.prisma.project.findMany({ orderBy: { createdAt: "asc" } });
    return projects.map(mapProject);
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const organization = await this.prisma.organization.upsert({
      where: { id: "org_demo" },
      update: {},
      create: { id: "org_demo", name: "Demo Organization" }
    });
    const project = await this.prisma.project.create({
      data: {
        id: id("proj"),
        organizationId: organization.id,
        name: input.name,
        publicKey: `pk_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        defaultLocale: input.defaultLocale ?? "zh-CN",
        inboxes: {
          create: {
            id: id("inbox"),
            name: "Default Inbox"
          }
        }
      }
    });
    return mapProject(project);
  }

  async findInbox(projectId: string, inboxId?: string): Promise<InboxRecord | undefined> {
    const inbox = await this.prisma.inbox.findFirst({
      where: {
        projectId,
        ...(inboxId ? { id: inboxId } : {})
      },
      orderBy: { createdAt: "asc" }
    });
    return inbox ? mapInbox(inbox) : undefined;
  }

  async findContact(projectId: string, contactId: string): Promise<ContactRecord | undefined> {
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: contactId,
        projectId
      }
    });
    return contact ? mapContact(contact) : undefined;
  }

  async upsertContact(projectId: string, input: ContactInput): Promise<ContactRecord> {
    const normalizedInput = {
      ...input,
      email: input.email?.trim().toLowerCase()
    };
    const existing = await this.prisma.contact.findFirst({
      where: {
        projectId,
        OR: [
          ...(normalizedInput.externalUserId
            ? [{ externalUserId: normalizedInput.externalUserId }]
            : []),
          ...(normalizedInput.email ? [{ email: normalizedInput.email }] : [])
        ]
      }
    });

    let contact;
    if (existing) {
      contact = await this.prisma.contact.update({
        where: { id: existing.id },
        data: {
          externalUserId: normalizedInput.externalUserId ?? existing.externalUserId,
          name: normalizedInput.name ?? existing.name,
          email: normalizedInput.email ?? existing.email,
          avatarUrl: normalizedInput.avatarUrl ?? existing.avatarUrl,
          metadata: jsonInput({
            ...jsonRecord(existing.metadata),
            ...(normalizedInput.metadata ?? {})
          })
        }
      });
    } else {
      try {
        contact = await this.prisma.contact.create({
          data: {
            id: id("contact"),
            projectId,
            externalUserId: normalizedInput.externalUserId,
            name: normalizedInput.name,
            email: normalizedInput.email,
            avatarUrl: normalizedInput.avatarUrl,
            metadata: jsonInput(normalizedInput.metadata ?? {})
          }
        });
      } catch (error) {
        if (!isPrismaUniqueConflict(error)) {
          throw error;
        }
        contact = await this.prisma.contact.findFirstOrThrow({
          where: {
            projectId,
            OR: [
              ...(normalizedInput.externalUserId
                ? [{ externalUserId: normalizedInput.externalUserId }]
                : []),
              ...(normalizedInput.email ? [{ email: normalizedInput.email }] : [])
            ]
          }
        });
      }
    }

    return mapContact(contact);
  }

  async createConversation(input: {
    projectId: string;
    inboxId: string;
    contactId: string;
    metadata?: JsonRecord;
  }): Promise<ConversationRecord> {
    const conversation = await this.prisma.conversation.create({
      data: {
        id: id("conv"),
        projectId: input.projectId,
        inboxId: input.inboxId,
        contactId: input.contactId,
        metadata: jsonInput(input.metadata ?? {})
      }
    });
    return mapConversation(conversation);
  }

  async createIdempotentConversation(input: {
    projectId: string;
    inboxId: string;
    contactId: string;
    idempotencyKey: string;
    idempotencyHash: string;
    metadata?: JsonRecord;
  }): Promise<{ conversation: ConversationRecord; created: boolean }> {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        projectId_idempotencyKey: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
    if (existing) {
      assertMatchingIdempotencyHash(existing.idempotencyHash, input.idempotencyHash);
      return { conversation: mapConversation(existing), created: false };
    }

    try {
      const conversation = await this.prisma.conversation.create({
        data: {
          id: id("conv"),
          projectId: input.projectId,
          inboxId: input.inboxId,
          contactId: input.contactId,
          idempotencyKey: input.idempotencyKey,
          idempotencyHash: input.idempotencyHash,
          metadata: jsonInput(input.metadata ?? {})
        }
      });
      return { conversation: mapConversation(conversation), created: true };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) {
        throw error;
      }
      const conversation = await this.prisma.conversation.findUniqueOrThrow({
        where: {
          projectId_idempotencyKey: {
            projectId: input.projectId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      assertMatchingIdempotencyHash(conversation.idempotencyHash, input.idempotencyHash);
      return { conversation: mapConversation(conversation), created: false };
    }
  }

  async findConversation(
    projectId: string,
    conversationId: string
  ): Promise<ConversationRecord | undefined> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        projectId
      }
    });
    return conversation ? mapConversation(conversation) : undefined;
  }

  async listConversations(projectId: string): Promise<ConversationRecord[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { projectId },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }]
    });
    return conversations.map(mapConversation);
  }

  async updateConversationStatus(input: {
    projectId: string;
    conversationId: string;
    status: ConversationStatus;
    assigneeType?: ConversationRecord["assigneeType"];
  }): Promise<ConversationRecord> {
    const conversation = await this.prisma.conversation.updateManyAndReturn({
      where: {
        id: input.conversationId,
        projectId: input.projectId
      },
      data: {
        status: input.status,
        assigneeType: input.assigneeType
      }
    });

    if (!conversation[0]) {
      throw new Error(`Conversation not found: ${input.conversationId}`);
    }

    return mapConversation(conversation[0]);
  }

  async listMessages(
    projectId: string,
    conversationId: string,
    options: { limit?: number; after?: string } = {}
  ): Promise<MessageRecord[]> {
    const limit = boundedMessageLimit(options.limit);
    if (options.after) {
      const cursor = await this.prisma.message.findFirst({
        where: { id: options.after, projectId, conversationId }
      });
      if (!cursor) {
        return [];
      }
    }
    const messages = await this.prisma.message.findMany({
      where: {
        projectId,
        conversationId,
        visibility: "public"
      },
      orderBy: { sequence: "asc" },
      take: limit,
      ...(options.after ? { cursor: { id: options.after }, skip: 1 } : {})
    });
    return messages.map(mapMessage);
  }

  async createMessage(input: {
    projectId: string;
    conversationId: string;
    message: CreateMessageInput;
  }): Promise<MessageRecord> {
    const message = await this.prisma.message.create({
      data: {
        id: id("msg"),
        projectId: input.projectId,
        conversationId: input.conversationId,
        role: input.message.role,
        visibility: input.message.visibility ?? "public",
        contentType: "text",
        content: jsonInput({ text: input.message.text }),
        sourceRefs: input.message.sourceRefs as unknown as Prisma.InputJsonValue,
        metadata: jsonInput(input.message.metadata ?? {})
      }
    });

    await this.prisma.conversation.updateMany({
      where: { id: input.conversationId, projectId: input.projectId },
      data: { lastMessageAt: message.createdAt }
    });

    return mapMessage(message);
  }

  async createIdempotentMessage(input: {
    projectId: string;
    conversationId: string;
    idempotencyKey: string;
    idempotencyHash: string;
    message: CreateMessageInput;
  }): Promise<{ message: MessageRecord; created: boolean }> {
    const existing = await this.prisma.message.findUnique({
      where: {
        conversationId_idempotencyKey: {
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
    if (existing) {
      assertMatchingIdempotencyHash(existing.idempotencyHash, input.idempotencyHash);
      return { message: mapMessage(existing), created: false };
    }

    try {
      const message = await this.prisma.message.create({
        data: {
          id: id("msg"),
          projectId: input.projectId,
          conversationId: input.conversationId,
          role: input.message.role,
          visibility: input.message.visibility ?? "public",
          contentType: "text",
          content: jsonInput({ text: input.message.text }),
          sourceRefs: input.message.sourceRefs as unknown as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
          idempotencyHash: input.idempotencyHash,
          metadata: jsonInput(input.message.metadata ?? {})
        }
      });
      await this.prisma.conversation.updateMany({
        where: { id: input.conversationId, projectId: input.projectId },
        data: { lastMessageAt: message.createdAt }
      });
      return { message: mapMessage(message), created: true };
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) {
        throw error;
      }
      const message = await this.prisma.message.findUniqueOrThrow({
        where: {
          conversationId_idempotencyKey: {
            conversationId: input.conversationId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      assertMatchingIdempotencyHash(message.idempotencyHash, input.idempotencyHash);
      return { message: mapMessage(message), created: false };
    }
  }

  async createKnowledgeDocument(
    projectId: string,
    input: CreateKnowledgeDocumentInput
  ): Promise<KnowledgeDocumentRecord> {
    const chunks = chunkText(input.content);
    const timestamp = new Date().toISOString();
    const document = await this.prisma.knowledgeDocument.create({
      data: {
        id: id("doc"),
        projectId,
        title: input.title,
        sourceType: input.sourceType,
        sourceUri: input.sourceUri,
        content: input.content,
        status: "indexed",
        contentHash: hash(input.content),
        metadata: jsonInput({
          ...(input.metadata ?? {}),
          chunk_count: chunks.length,
          indexed_at: timestamp
        }),
        chunks: {
          create: chunks.map((content, index) => ({
            id: id("chunk"),
            projectId,
            chunkIndex: index,
            content,
            tokenCount: content.length,
            metadata: jsonInput({
              title: input.title,
              source_uri: input.sourceUri
            })
          }))
        }
      }
    });
    return mapKnowledgeDocument(document);
  }

  async listKnowledgeDocuments(projectId: string): Promise<KnowledgeDocumentRecord[]> {
    const documents = await this.prisma.knowledgeDocument.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" }
    });
    return documents.map(mapKnowledgeDocument);
  }

  async findKnowledgeDocument(
    projectId: string,
    documentId: string
  ): Promise<KnowledgeDocumentRecord | undefined> {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, projectId }
    });
    return document ? mapKnowledgeDocument(document) : undefined;
  }

  async updateKnowledgeDocumentIndexState(input: {
    projectId: string;
    documentId: string;
    status: KnowledgeDocumentRecord["status"];
    metadata?: JsonRecord;
    error?: string;
  }): Promise<KnowledgeDocumentRecord> {
    const existing = await this.prisma.knowledgeDocument.findFirst({
      where: { id: input.documentId, projectId: input.projectId }
    });
    if (!existing) {
      throw new Error(`Knowledge document not found: ${input.documentId}`);
    }
    const document = await this.prisma.knowledgeDocument.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        metadata: input.metadata === undefined ? undefined : jsonInput(input.metadata),
        error: input.error ?? null
      }
    });
    return mapKnowledgeDocument(document);
  }

  async retrieveKnowledge(
    projectId: string,
    query: string,
    limit: number
  ): Promise<KnowledgeChunkRecord[]> {
    const terms = tokenize(query);
    if (terms.length === 0) {
      return [];
    }

    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { projectId },
      take: 200,
      orderBy: { createdAt: "desc" }
    });

    return chunks
      .map((chunk) => ({
        ...mapKnowledgeChunk(chunk),
        score: scoreChunk(chunk.content, terms)
      }))
      .filter((chunk) => (chunk.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

  async getActiveLlmProvider(projectId: string): Promise<LlmProviderRecord | undefined> {
    const provider = await this.prisma.llmProvider.findFirst({
      where: { projectId, status: "active" },
      orderBy: { createdAt: "desc" }
    });
    return provider ? mapLlmProvider(provider) : undefined;
  }

  async upsertLlmProvider(
    input: Omit<LlmProviderRecord, "id" | "metadata"> & { id?: string; metadata?: JsonRecord }
  ): Promise<LlmProviderRecord> {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { projectId: input.projectId }
    });
    const provider = existing
      ? await this.prisma.llmProvider.update({
          where: { id: existing.id },
          data: {
            provider: input.provider,
            baseUrl: input.baseUrl,
            model: input.model,
            embeddingModel: input.embeddingModel,
            apiKeyEncrypted: input.apiKeyEncrypted,
            status: input.status,
            metadata: jsonInput(input.metadata ?? existing.metadata)
          }
        })
      : await this.prisma.llmProvider.create({
          data: {
            id: input.id ?? id("llm"),
            projectId: input.projectId,
            provider: input.provider,
            baseUrl: input.baseUrl,
            model: input.model,
            embeddingModel: input.embeddingModel,
            apiKeyEncrypted: input.apiKeyEncrypted,
            status: input.status,
            metadata: jsonInput(input.metadata ?? {})
          }
        });
    return mapLlmProvider(provider);
  }

  async createAiRun(input: CreateAiRunInput): Promise<AiRunRecord> {
    const run = await this.prisma.aiRun.create({
      data: {
        id: id("airun"),
        projectId: input.projectId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        retrievedChunkIds: jsonInput(input.retrievedChunkIds),
        confidence: input.confidence,
        status: input.status,
        error: input.error,
        metadata: jsonInput(input.metadata)
      }
    });
    return mapAiRun(run);
  }

  async listAiRuns(projectId: string, conversationId?: string): Promise<AiRunRecord[]> {
    const runs = await this.prisma.aiRun.findMany({
      where: {
        projectId,
        ...(conversationId ? { conversationId } : {})
      },
      orderBy: { createdAt: "desc" }
    });
    return runs.map(mapAiRun);
  }

  async createHandoffSession(input: {
    projectId: string;
    conversationId: string;
    provider: string;
    reason?: HandoffSessionRecord["reason"];
    metadata?: JsonRecord;
  }): Promise<HandoffSessionRecord> {
    const session = await this.prisma.handoffSession.create({
      data: {
        id: id("handoff"),
        projectId: input.projectId,
        conversationId: input.conversationId,
        provider: input.provider,
        reason: input.reason,
        metadata: jsonInput(input.metadata ?? {})
      }
    });
    return mapHandoffSession(session);
  }

  async updateHandoffSession(input: {
    id: string;
    status?: HandoffSessionRecord["status"];
    externalContactId?: string;
    externalConversationId?: string;
    metadata?: JsonRecord;
  }): Promise<HandoffSessionRecord> {
    const session = await this.prisma.handoffSession.update({
      where: { id: input.id },
      data: {
        status: input.status,
        externalContactId: input.externalContactId,
        externalConversationId: input.externalConversationId,
        metadata: input.metadata ? jsonInput(input.metadata) : undefined
      }
    });
    return mapHandoffSession(session);
  }

  async findHandoffSession(input: {
    projectId: string;
    id: string;
  }): Promise<HandoffSessionRecord | undefined> {
    const session = await this.prisma.handoffSession.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId
      }
    });
    return session ? mapHandoffSession(session) : undefined;
  }

  async listHandoffSessions(input: {
    projectId: string;
    conversationId?: string;
  }): Promise<HandoffSessionRecord[]> {
    const sessions = await this.prisma.handoffSession.findMany({
      where: {
        projectId: input.projectId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {})
      },
      orderBy: { createdAt: "desc" }
    });
    return sessions.map(mapHandoffSession);
  }

  async upsertIntegrationConfig(input: {
    projectId: string;
    provider: string;
    status: "active" | "disabled";
    configEncrypted: string;
    metadata?: JsonRecord;
  }): Promise<IntegrationConfigRecord> {
    const config = await this.prisma.integrationConfig.upsert({
      where: {
        projectId_provider: {
          projectId: input.projectId,
          provider: input.provider
        }
      },
      update: {
        status: input.status,
        configEncrypted: input.configEncrypted,
        metadata: jsonInput(input.metadata ?? {})
      },
      create: {
        id: id("integration"),
        projectId: input.projectId,
        provider: input.provider,
        status: input.status,
        configEncrypted: input.configEncrypted,
        metadata: jsonInput(input.metadata ?? {})
      }
    });
    return mapIntegrationConfig(config);
  }

  async getIntegrationConfig(
    projectId: string,
    provider: string
  ): Promise<IntegrationConfigRecord | undefined> {
    const config = await this.prisma.integrationConfig.findUnique({
      where: {
        projectId_provider: {
          projectId,
          provider
        }
      }
    });
    return config ? mapIntegrationConfig(config) : undefined;
  }

  async createWebhookEvent(input: {
    projectId: string;
    provider: string;
    externalEventId?: string;
    payload: JsonRecord;
  }): Promise<WebhookEventRecord> {
    if (input.externalEventId) {
      const existing = await this.prisma.webhookEvent.findUnique({
        where: {
          projectId_provider_externalEventId: {
            projectId: input.projectId,
            provider: input.provider,
            externalEventId: input.externalEventId
          }
        }
      });
      if (existing) {
        return mapWebhookEvent(existing);
      }
    }

    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          id: id("webhook"),
          projectId: input.projectId,
          provider: input.provider,
          externalEventId: input.externalEventId,
          payload: jsonInput(input.payload)
        }
      });
      return mapWebhookEvent(event);
    } catch (error) {
      if (!input.externalEventId || !isPrismaUniqueConflict(error)) {
        throw error;
      }
      const event = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: {
          projectId_provider_externalEventId: {
            projectId: input.projectId,
            provider: input.provider,
            externalEventId: input.externalEventId
          }
        }
      });
      return mapWebhookEvent(event);
    }
  }

  async markWebhookEvent(input: {
    id: string;
    status: WebhookEventRecord["status"];
    error?: string;
  }): Promise<WebhookEventRecord> {
    const event = await this.prisma.webhookEvent.update({
      where: { id: input.id },
      data: {
        status: input.status,
        error: input.error ?? null,
        processedAt: ["processed", "failed", "ignored"].includes(input.status) ? new Date() : null
      }
    });
    return mapWebhookEvent(event);
  }

  async claimWebhookEvent(input: {
    projectId: string;
    id: string;
    now?: string;
  }): Promise<{ event: WebhookEventRecord; claimed: boolean }> {
    const claimed = await this.prisma.webhookEvent.updateManyAndReturn({
      where: {
        id: input.id,
        projectId: input.projectId,
        status: "received"
      },
      data: {
        status: "processing",
        attempts: { increment: 1 },
        processingStartedAt: input.now ? new Date(input.now) : new Date(),
        processedAt: null,
        error: null
      }
    });
    if (claimed[0]) {
      return { event: mapWebhookEvent(claimed[0]), claimed: true };
    }
    const event = await this.prisma.webhookEvent.findFirstOrThrow({
      where: { id: input.id, projectId: input.projectId }
    });
    return { event: mapWebhookEvent(event), claimed: false };
  }

  async findWebhookEvent(input: {
    projectId: string;
    id: string;
  }): Promise<WebhookEventRecord | undefined> {
    const event = await this.prisma.webhookEvent.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId
      }
    });
    return event ? mapWebhookEvent(event) : undefined;
  }

  async listWebhookEvents(input: {
    projectId: string;
    provider?: string;
    status?: WebhookEventRecord["status"];
    limit?: number;
  }): Promise<WebhookEventRecord[]> {
    const events = await this.prisma.webhookEvent.findMany({
      where: {
        projectId: input.projectId,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.status ? { status: input.status } : {})
      },
      take: input.limit ?? 50,
      orderBy: { createdAt: "desc" }
    });
    return events.map(mapWebhookEvent);
  }

  async findHandoffByExternalConversation(input: {
    projectId: string;
    provider: string;
    externalConversationId: string;
  }): Promise<HandoffSessionRecord | undefined> {
    const session = await this.prisma.handoffSession.findFirst({
      where: {
        projectId: input.projectId,
        provider: input.provider,
        externalConversationId: input.externalConversationId
      }
    });
    return session ? mapHandoffSession(session) : undefined;
  }

  async createAuditLog(input: {
    projectId?: string;
    organizationId?: string;
    actorType: AuditLogRecord["actorType"];
    actorId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: JsonRecord;
    requestId?: string;
  }): Promise<AuditLogRecord> {
    const auditLog = await this.prisma.auditLog.create({
      data: {
        id: id("audit"),
        projectId: input.projectId,
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: jsonInput(input.metadata ?? {}),
        requestId: input.requestId
      }
    });
    return mapAuditLog(auditLog);
  }

  async listAuditLogs(input: {
    projectId: string;
    action?: string;
    limit?: number;
  }): Promise<AuditLogRecord[]> {
    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        projectId: input.projectId,
        ...(input.action ? { action: input.action } : {})
      },
      take: input.limit ?? 100,
      orderBy: { createdAt: "desc" }
    });
    return auditLogs.map(mapAuditLog);
  }

  async upsertToolDefinition(input: {
    projectId: string;
    slug: string;
    name: string;
    description: string;
    kind: ToolDefinitionRecord["kind"];
    status: ToolDefinitionRecord["status"];
    method?: string;
    path?: string;
    inputSchema?: JsonRecord;
    outputSchema?: JsonRecord;
    metadata?: JsonRecord;
  }): Promise<ToolDefinitionRecord> {
    const tool = await this.prisma.toolDefinition.upsert({
      where: {
        projectId_slug: {
          projectId: input.projectId,
          slug: input.slug
        }
      },
      update: {
        name: input.name,
        description: input.description,
        kind: input.kind,
        status: input.status,
        method: input.method,
        path: input.path,
        inputSchema: jsonInput(input.inputSchema ?? {}),
        outputSchema: jsonInput(input.outputSchema ?? {}),
        metadata: jsonInput(input.metadata ?? {})
      },
      create: {
        id: id("tool"),
        projectId: input.projectId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        kind: input.kind,
        status: input.status,
        method: input.method,
        path: input.path,
        inputSchema: jsonInput(input.inputSchema ?? {}),
        outputSchema: jsonInput(input.outputSchema ?? {}),
        metadata: jsonInput(input.metadata ?? {})
      }
    });
    return mapToolDefinition(tool);
  }

  async listToolDefinitions(input: {
    projectId: string;
    status?: ToolDefinitionRecord["status"];
    limit?: number;
  }): Promise<ToolDefinitionRecord[]> {
    const tools = await this.prisma.toolDefinition.findMany({
      where: {
        projectId: input.projectId,
        ...(input.status ? { status: input.status } : {})
      },
      take: input.limit ?? 100,
      orderBy: { slug: "asc" }
    });
    return tools.map(mapToolDefinition);
  }

  async findToolDefinitionBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<ToolDefinitionRecord | undefined> {
    const tool = await this.prisma.toolDefinition.findUnique({
      where: {
        projectId_slug: {
          projectId: input.projectId,
          slug: input.slug
        }
      }
    });
    return tool ? mapToolDefinition(tool) : undefined;
  }

  async updateToolDefinitionStatus(input: {
    projectId: string;
    id: string;
    status: ToolDefinitionRecord["status"];
  }): Promise<ToolDefinitionRecord> {
    const tools = await this.prisma.toolDefinition.updateManyAndReturn({
      where: {
        id: input.id,
        projectId: input.projectId
      },
      data: {
        status: input.status
      }
    });
    if (!tools[0]) {
      throw new Error(`Tool definition not found: ${input.id}`);
    }
    return mapToolDefinition(tools[0]);
  }

  async createToolCall(input: {
    projectId: string;
    conversationId?: string;
    messageId?: string;
    toolId?: string;
    toolSlug: string;
    status: ToolCallRecord["status"];
    input?: JsonRecord;
    output?: JsonRecord;
    error?: string;
    latencyMs?: number;
  }): Promise<ToolCallRecord> {
    const toolCall = await this.prisma.toolCall.create({
      data: {
        id: id("toolcall"),
        projectId: input.projectId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        toolId: input.toolId,
        toolSlug: input.toolSlug,
        status: input.status,
        input: jsonInput(input.input ?? {}),
        output: input.output ? jsonInput(input.output) : undefined,
        error: input.error,
        latencyMs: input.latencyMs
      }
    });
    return mapToolCall(toolCall);
  }

  async listToolCalls(input: {
    projectId: string;
    conversationId?: string;
    limit?: number;
  }): Promise<ToolCallRecord[]> {
    const toolCalls = await this.prisma.toolCall.findMany({
      where: {
        projectId: input.projectId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {})
      },
      take: input.limit ?? 100,
      orderBy: { createdAt: "desc" }
    });
    return toolCalls.map(mapToolCall);
  }

  async getConversationInsight(input: {
    projectId: string;
    conversationId: string;
  }): Promise<ConversationInsightRecord | undefined> {
    const insight = await this.prisma.conversationInsight.findFirst({
      where: {
        projectId: input.projectId,
        conversationId: input.conversationId
      }
    });
    return insight ? mapConversationInsight(insight) : undefined;
  }

  async upsertConversationInsight(input: {
    projectId: string;
    conversationId: string;
    summary: string;
    suggestedReplies: string[];
    tags: string[];
    metadata?: JsonRecord;
  }): Promise<ConversationInsightRecord> {
    const insight = await this.prisma.conversationInsight.upsert({
      where: {
        conversationId: input.conversationId
      },
      update: {
        summary: input.summary,
        suggestedReplies: jsonInput(input.suggestedReplies),
        tags: jsonInput(input.tags),
        metadata: jsonInput(input.metadata ?? {})
      },
      create: {
        id: id("insight"),
        projectId: input.projectId,
        conversationId: input.conversationId,
        summary: input.summary,
        suggestedReplies: jsonInput(input.suggestedReplies),
        tags: jsonInput(input.tags),
        metadata: jsonInput(input.metadata ?? {})
      }
    });
    return mapConversationInsight(insight);
  }

  async createAsyncJob(input: {
    projectId: string;
    type: string;
    payload?: JsonRecord;
    runAt?: string;
    maxAttempts?: number;
  }): Promise<AsyncJobRecord> {
    const job = await this.prisma.asyncJob.create({
      data: {
        id: id("job"),
        projectId: input.projectId,
        type: input.type,
        payload: jsonInput(input.payload ?? {}),
        runAt: input.runAt ? new Date(input.runAt) : undefined,
        maxAttempts: input.maxAttempts ?? 3
      }
    });
    return mapAsyncJob(job);
  }

  async listAsyncJobs(input: {
    projectId: string;
    status?: AsyncJobStatus;
    type?: string;
    limit?: number;
  }): Promise<AsyncJobRecord[]> {
    const jobs = await this.prisma.asyncJob.findMany({
      where: {
        projectId: input.projectId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.type ? { type: input.type } : {})
      },
      take: input.limit ?? 50,
      orderBy: { createdAt: "desc" }
    });
    return jobs.map(mapAsyncJob);
  }

  async claimNextAsyncJob(input: {
    workerId: string;
    types?: string[];
    now?: string;
    leaseMs?: number;
  }): Promise<AsyncJobRecord | undefined> {
    const nowValue = input.now ? new Date(input.now) : new Date();
    const leaseExpiresAt = new Date(nowValue.getTime() + (input.leaseMs ?? 60_000));
    await this.prisma.asyncJob.updateMany({
      where: {
        status: "running",
        leaseExpiresAt: { lte: nowValue },
        attempts: { gte: this.prisma.asyncJob.fields.maxAttempts }
      },
      data: {
        status: "failed",
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        error: "Job lease expired after the maximum number of attempts"
      }
    });

    const typeFilter = input.types?.length
      ? Prisma.sql`AND "type" IN (${Prisma.join(input.types)})`
      : Prisma.empty;
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "async_jobs"
        WHERE (
          ("status" = 'queued' AND "run_at" <= ${nowValue})
          OR ("status" = 'running' AND "lease_expires_at" <= ${nowValue})
        )
        AND "attempts" < "max_attempts"
        ${typeFilter}
        ORDER BY "run_at" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "async_jobs" AS job
      SET
        "status" = 'running',
        "attempts" = job."attempts" + 1,
        "locked_by" = ${input.workerId},
        "locked_at" = ${nowValue},
        "lease_expires_at" = ${leaseExpiresAt},
        "updated_at" = ${nowValue}
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id"
    `);
    if (!claimed[0]) {
      return undefined;
    }
    return mapAsyncJob(
      await this.prisma.asyncJob.findUniqueOrThrow({ where: { id: claimed[0].id } })
    );
  }

  async renewAsyncJobLease(input: {
    id: string;
    workerId: string;
    now?: string;
    leaseMs?: number;
  }): Promise<AsyncJobRecord> {
    const nowValue = input.now ? new Date(input.now) : new Date();
    const jobs = await this.prisma.asyncJob.updateManyAndReturn({
      where: { id: input.id, status: "running", lockedBy: input.workerId },
      data: { leaseExpiresAt: new Date(nowValue.getTime() + (input.leaseMs ?? 60_000)) }
    });
    return mapAsyncJob(requireOwnedJob(jobs[0], input.id));
  }

  async completeAsyncJob(input: {
    id: string;
    workerId: string;
    result?: JsonRecord;
  }): Promise<AsyncJobRecord> {
    const jobs = await this.prisma.asyncJob.updateManyAndReturn({
      where: { id: input.id, status: "running", lockedBy: input.workerId },
      data: {
        status: "completed",
        result: jsonInput(input.result ?? {}),
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        error: null
      }
    });
    return mapAsyncJob(requireOwnedJob(jobs[0], input.id));
  }

  async failAsyncJob(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt?: string;
  }): Promise<AsyncJobRecord> {
    const existing = await this.prisma.asyncJob.findFirst({
      where: { id: input.id, status: "running", lockedBy: input.workerId }
    });
    if (!existing) {
      throw new Error(`Async job lease is not owned by this worker: ${input.id}`);
    }

    const shouldRetry = Boolean(input.retryAt) && existing.attempts < existing.maxAttempts;
    const jobs = await this.prisma.asyncJob.updateManyAndReturn({
      where: { id: input.id, status: "running", lockedBy: input.workerId },
      data: {
        status: shouldRetry ? "queued" : "failed",
        runAt: shouldRetry && input.retryAt ? new Date(input.retryAt) : existing.runAt,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null,
        error: input.error
      }
    });
    return mapAsyncJob(requireOwnedJob(jobs[0], input.id));
  }
}

type PrismaProject = Awaited<ReturnType<PrismaClient["project"]["findFirst"]>>;
type PrismaInbox = Awaited<ReturnType<PrismaClient["inbox"]["findFirst"]>>;
type PrismaContact = Awaited<ReturnType<PrismaClient["contact"]["findFirst"]>>;
type PrismaConversation = Awaited<ReturnType<PrismaClient["conversation"]["findFirst"]>>;
type PrismaMessage = Awaited<ReturnType<PrismaClient["message"]["findFirst"]>>;
type PrismaKnowledgeDocument = Awaited<ReturnType<PrismaClient["knowledgeDocument"]["findFirst"]>>;
type PrismaKnowledgeChunk = Awaited<ReturnType<PrismaClient["knowledgeChunk"]["findFirst"]>>;
type PrismaLlmProvider = Awaited<ReturnType<PrismaClient["llmProvider"]["findFirst"]>>;
type PrismaAiRun = Awaited<ReturnType<PrismaClient["aiRun"]["findFirst"]>>;
type PrismaHandoffSession = Awaited<ReturnType<PrismaClient["handoffSession"]["findFirst"]>>;
type PrismaIntegrationConfig = Awaited<ReturnType<PrismaClient["integrationConfig"]["findFirst"]>>;
type PrismaWebhookEvent = Awaited<ReturnType<PrismaClient["webhookEvent"]["findFirst"]>>;
type PrismaApiKey = Awaited<ReturnType<PrismaClient["apiKey"]["findFirst"]>>;
type PrismaAuditLog = Awaited<ReturnType<PrismaClient["auditLog"]["findFirst"]>>;
type PrismaToolDefinition = Awaited<ReturnType<PrismaClient["toolDefinition"]["findFirst"]>>;
type PrismaToolCall = Awaited<ReturnType<PrismaClient["toolCall"]["findFirst"]>>;
type PrismaConversationInsight = Awaited<
  ReturnType<PrismaClient["conversationInsight"]["findFirst"]>
>;
type PrismaAsyncJob = Awaited<ReturnType<PrismaClient["asyncJob"]["findFirst"]>>;

function mapProject(project: NonNullable<PrismaProject>): ProjectRecord {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    publicKey: project.publicKey,
    defaultLocale: project.defaultLocale,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}

function mapInbox(inbox: NonNullable<PrismaInbox>): InboxRecord {
  return {
    id: inbox.id,
    projectId: inbox.projectId,
    name: inbox.name,
    handoffProvider: inbox.handoffProvider ?? undefined
  };
}

function mapContact(contact: NonNullable<PrismaContact>): ContactRecord {
  return {
    id: contact.id,
    projectId: contact.projectId,
    externalUserId: contact.externalUserId ?? undefined,
    name: contact.name ?? undefined,
    email: contact.email ?? undefined,
    avatarUrl: contact.avatarUrl ?? undefined,
    metadata: jsonRecord(contact.metadata),
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString()
  };
}

function mapConversation(conversation: NonNullable<PrismaConversation>): ConversationRecord {
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    inboxId: conversation.inboxId,
    contactId: conversation.contactId,
    status: conversation.status as ConversationStatus,
    assigneeType: conversation.assigneeType as ConversationRecord["assigneeType"],
    metadata: jsonRecord(conversation.metadata),
    lastMessageAt: iso(conversation.lastMessageAt),
    idempotencyKey: conversation.idempotencyKey ?? undefined,
    idempotencyHash: conversation.idempotencyHash ?? undefined,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString()
  };
}

function mapMessage(message: NonNullable<PrismaMessage>): MessageRecord {
  return {
    id: message.id,
    projectId: message.projectId,
    conversationId: message.conversationId,
    role: message.role as MessageRole,
    visibility: message.visibility as MessageVisibility,
    contentType: "text",
    content: jsonRecord(message.content),
    sourceRefs: sourceReferences(message.sourceRefs),
    idempotencyKey: message.idempotencyKey ?? undefined,
    idempotencyHash: message.idempotencyHash ?? undefined,
    metadata: jsonRecord(message.metadata),
    createdAt: message.createdAt.toISOString()
  };
}

function mapKnowledgeDocument(
  document: NonNullable<PrismaKnowledgeDocument>
): KnowledgeDocumentRecord {
  return {
    id: document.id,
    projectId: document.projectId,
    title: document.title,
    sourceType: document.sourceType as KnowledgeDocumentRecord["sourceType"],
    sourceUri: document.sourceUri ?? undefined,
    status: document.status as KnowledgeDocumentRecord["status"],
    contentHash: document.contentHash ?? undefined,
    metadata: jsonRecord(document.metadata),
    error: document.error ?? undefined,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

function mapKnowledgeChunk(chunk: NonNullable<PrismaKnowledgeChunk>): KnowledgeChunkRecord {
  return {
    id: chunk.id,
    projectId: chunk.projectId,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    tokenCount: chunk.tokenCount ?? undefined,
    metadata: jsonRecord(chunk.metadata)
  };
}

function mapLlmProvider(provider: NonNullable<PrismaLlmProvider>): LlmProviderRecord {
  return {
    id: provider.id,
    projectId: provider.projectId,
    provider: "openai_compatible",
    baseUrl: provider.baseUrl,
    model: provider.model,
    embeddingModel: provider.embeddingModel ?? undefined,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    status: provider.status as LlmProviderRecord["status"],
    metadata: jsonRecord(provider.metadata)
  };
}

function mapAiRun(run: NonNullable<PrismaAiRun>): AiRunRecord {
  return {
    id: run.id,
    projectId: run.projectId,
    conversationId: run.conversationId,
    messageId: run.messageId ?? undefined,
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    inputTokens: run.inputTokens ?? undefined,
    outputTokens: run.outputTokens ?? undefined,
    latencyMs: run.latencyMs ?? undefined,
    retrievedChunkIds: stringArray(run.retrievedChunkIds),
    confidence: run.confidence ?? undefined,
    status: run.status as AiRunRecord["status"],
    error: run.error ?? undefined,
    metadata: jsonRecord(run.metadata),
    createdAt: run.createdAt.toISOString()
  };
}

function mapHandoffSession(session: NonNullable<PrismaHandoffSession>): HandoffSessionRecord {
  return {
    id: session.id,
    projectId: session.projectId,
    conversationId: session.conversationId,
    provider: session.provider,
    externalContactId: session.externalContactId ?? undefined,
    externalConversationId: session.externalConversationId ?? undefined,
    status: session.status as HandoffSessionRecord["status"],
    reason: session.reason as HandoffSessionRecord["reason"],
    metadata: jsonRecord(session.metadata),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString()
  };
}

function mapIntegrationConfig(
  config: NonNullable<PrismaIntegrationConfig>
): IntegrationConfigRecord {
  return {
    id: config.id,
    projectId: config.projectId,
    provider: config.provider,
    status: config.status as IntegrationConfigRecord["status"],
    configEncrypted: config.configEncrypted,
    metadata: jsonRecord(config.metadata),
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function mapWebhookEvent(event: NonNullable<PrismaWebhookEvent>): WebhookEventRecord {
  return {
    id: event.id,
    projectId: event.projectId,
    provider: event.provider,
    externalEventId: event.externalEventId ?? undefined,
    payload: jsonRecord(event.payload),
    status: event.status as WebhookEventRecord["status"],
    error: event.error ?? undefined,
    attempts: event.attempts,
    createdAt: event.createdAt.toISOString(),
    processedAt: iso(event.processedAt),
    processingStartedAt: iso(event.processingStartedAt)
  };
}

function mapApiKey(apiKey: NonNullable<PrismaApiKey>): ApiKeyRecord {
  return {
    id: apiKey.id,
    projectId: apiKey.projectId ?? undefined,
    organizationId: apiKey.organizationId ?? undefined,
    name: apiKey.name,
    keyHash: apiKey.keyHash,
    scopes: stringArray(apiKey.scopes),
    lastUsedAt: iso(apiKey.lastUsedAt),
    createdAt: apiKey.createdAt.toISOString(),
    revokedAt: iso(apiKey.revokedAt)
  };
}

function mapAuditLog(auditLog: NonNullable<PrismaAuditLog>): AuditLogRecord {
  return {
    id: auditLog.id,
    projectId: auditLog.projectId ?? undefined,
    organizationId: auditLog.organizationId ?? undefined,
    actorType: auditLog.actorType as AuditLogRecord["actorType"],
    actorId: auditLog.actorId ?? undefined,
    action: auditLog.action,
    targetType: auditLog.targetType ?? undefined,
    targetId: auditLog.targetId ?? undefined,
    metadata: jsonRecord(auditLog.metadata),
    requestId: auditLog.requestId ?? undefined,
    createdAt: auditLog.createdAt.toISOString()
  };
}

function mapToolDefinition(tool: NonNullable<PrismaToolDefinition>): ToolDefinitionRecord {
  return {
    id: tool.id,
    projectId: tool.projectId,
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    kind: tool.kind as ToolDefinitionRecord["kind"],
    status: tool.status as ToolDefinitionRecord["status"],
    method: tool.method ?? undefined,
    path: tool.path ?? undefined,
    inputSchema: jsonRecord(tool.inputSchema),
    outputSchema: jsonRecord(tool.outputSchema),
    metadata: jsonRecord(tool.metadata),
    createdAt: tool.createdAt.toISOString(),
    updatedAt: tool.updatedAt.toISOString()
  };
}

function mapToolCall(toolCall: NonNullable<PrismaToolCall>): ToolCallRecord {
  return {
    id: toolCall.id,
    projectId: toolCall.projectId,
    conversationId: toolCall.conversationId ?? undefined,
    messageId: toolCall.messageId ?? undefined,
    toolId: toolCall.toolId ?? undefined,
    toolSlug: toolCall.toolSlug,
    status: toolCall.status as ToolCallRecord["status"],
    input: jsonRecord(toolCall.input),
    output: toolCall.output ? jsonRecord(toolCall.output) : undefined,
    error: toolCall.error ?? undefined,
    latencyMs: toolCall.latencyMs ?? undefined,
    createdAt: toolCall.createdAt.toISOString()
  };
}

function mapConversationInsight(
  insight: NonNullable<PrismaConversationInsight>
): ConversationInsightRecord {
  return {
    id: insight.id,
    projectId: insight.projectId,
    conversationId: insight.conversationId,
    summary: insight.summary,
    suggestedReplies: stringArray(insight.suggestedReplies),
    tags: stringArray(insight.tags),
    metadata: jsonRecord(insight.metadata),
    createdAt: insight.createdAt.toISOString(),
    updatedAt: insight.updatedAt.toISOString()
  };
}

function mapAsyncJob(job: NonNullable<PrismaAsyncJob>): AsyncJobRecord {
  return {
    id: job.id,
    projectId: job.projectId,
    type: job.type,
    status: job.status as AsyncJobStatus,
    payload: jsonRecord(job.payload),
    result: job.result ? jsonRecord(job.result) : undefined,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt.toISOString(),
    lockedBy: job.lockedBy ?? undefined,
    lockedAt: iso(job.lockedAt),
    leaseExpiresAt: iso(job.leaseExpiresAt),
    error: job.error ?? undefined,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

function boundedMessageLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 200, 201));
}

function assertMatchingIdempotencyHash(existing: string | null, requested: string): void {
  if (existing !== requested) {
    throw new IdempotencyConflictError(
      "Idempotency key was already used with a different request payload"
    );
  }
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function requireOwnedJob<T>(job: T | undefined, id: string): T {
  if (!job) {
    throw new Error(`Async job lease is not owned by this worker: ${id}`);
  }
  return job;
}

function demoToolDefinitions(
  projectId: string
): Array<
  Pick<
    ToolDefinitionRecord,
    | "id"
    | "projectId"
    | "slug"
    | "name"
    | "description"
    | "kind"
    | "status"
    | "method"
    | "path"
    | "inputSchema"
    | "outputSchema"
    | "metadata"
  >
> {
  return [
    {
      id: "tool_demo_order_lookup",
      projectId,
      slug: "demo.order_lookup",
      name: "Demo order lookup",
      description: "Looks up a demo billing order by order_id.",
      kind: "demo",
      status: "active",
      method: "GET",
      path: "demo://orders/{order_id}",
      inputSchema: {
        type: "object",
        required: ["order_id"],
        properties: {
          order_id: { type: "string" }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          found: { type: "boolean" },
          order_id: { type: "string" },
          status: { type: "string" }
        }
      },
      metadata: {
        readonly: true,
        demo: true
      }
    },
    {
      id: "tool_demo_subscription_lookup",
      projectId,
      slug: "demo.subscription_lookup",
      name: "Demo subscription lookup",
      description: "Looks up the demo user's subscription status by external_user_id.",
      kind: "demo",
      status: "active",
      method: "GET",
      path: "demo://subscriptions/{external_user_id}",
      inputSchema: {
        type: "object",
        required: ["external_user_id"],
        properties: {
          external_user_id: { type: "string" }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          found: { type: "boolean" },
          status: { type: "string" },
          plan: { type: "string" }
        }
      },
      metadata: {
        readonly: true,
        demo: true
      }
    }
  ];
}
