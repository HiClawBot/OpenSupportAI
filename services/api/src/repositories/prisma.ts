import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { chunkText, scoreChunk, tokenize } from "../knowledge-text";
import type {
  AiRunRecord,
  ContactInput,
  ContactRecord,
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
  WebhookEventRecord
} from "./types";
import type {
  ConversationStatus,
  MessageRole,
  MessageVisibility,
  SourceReference
} from "@opensupportai/protocol";

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
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

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
    return apiKey?.project ? mapProject(apiKey.project) : undefined;
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

  async upsertContact(projectId: string, input: ContactInput): Promise<ContactRecord> {
    const existing = await this.prisma.contact.findFirst({
      where: {
        projectId,
        OR: [
          ...(input.externalUserId ? [{ externalUserId: input.externalUserId }] : []),
          ...(input.email ? [{ email: input.email }] : [])
        ]
      }
    });

    const contact = existing
      ? await this.prisma.contact.update({
          where: { id: existing.id },
          data: {
            externalUserId: input.externalUserId ?? existing.externalUserId,
            name: input.name ?? existing.name,
            email: input.email ?? existing.email,
            avatarUrl: input.avatarUrl ?? existing.avatarUrl,
            metadata: jsonInput({
              ...jsonRecord(existing.metadata),
              ...(input.metadata ?? {})
            })
          }
        })
      : await this.prisma.contact.create({
          data: {
            id: id("contact"),
            projectId,
            externalUserId: input.externalUserId,
            name: input.name,
            email: input.email,
            avatarUrl: input.avatarUrl,
            metadata: jsonInput(input.metadata ?? {})
          }
        });

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

  async listMessages(projectId: string, conversationId: string): Promise<MessageRecord[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        projectId,
        conversationId,
        visibility: "public"
      },
      orderBy: { createdAt: "asc" }
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

  async createKnowledgeDocument(
    projectId: string,
    input: CreateKnowledgeDocumentInput
  ): Promise<KnowledgeDocumentRecord> {
    const chunks = chunkText(input.content);
    const document = await this.prisma.knowledgeDocument.create({
      data: {
        id: id("doc"),
        projectId,
        title: input.title,
        sourceType: input.sourceType,
        sourceUri: input.sourceUri,
        status: "indexed",
        metadata: jsonInput(input.metadata ?? {}),
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
          provider_externalEventId: {
            provider: input.provider,
            externalEventId: input.externalEventId
          }
        }
      });
      if (existing) {
        return mapWebhookEvent(existing);
      }
    }

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
        error: input.error,
        processedAt: new Date()
      }
    });
    return mapWebhookEvent(event);
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
    metadata: jsonRecord(document.metadata),
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
    createdAt: event.createdAt.toISOString(),
    processedAt: iso(event.processedAt)
  };
}
