import { createHash, randomUUID } from "node:crypto";
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
import { chunkText, scoreChunk, tokenize } from "../knowledge-text";

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class MemorySupportRepository implements SupportRepository {
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly inboxes = new Map<string, InboxRecord>();
  private readonly contacts = new Map<string, ContactRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, MessageRecord>();
  private readonly knowledgeDocuments = new Map<string, KnowledgeDocumentRecord>();
  private readonly knowledgeChunks = new Map<string, KnowledgeChunkRecord>();
  private readonly llmProviders = new Map<string, LlmProviderRecord>();
  private readonly aiRuns = new Map<string, AiRunRecord>();
  private readonly handoffSessions = new Map<string, HandoffSessionRecord>();
  private readonly integrationConfigs = new Map<string, IntegrationConfigRecord>();
  private readonly webhookEvents = new Map<string, WebhookEventRecord>();
  private readonly adminKeyToProject = new Map<string, string>();

  async seedDemo(): Promise<void> {
    if (this.projects.has("proj_demo")) {
      return;
    }

    const timestamp = now();
    const project: ProjectRecord = {
      id: "proj_demo",
      organizationId: "org_demo",
      name: "Demo Project",
      publicKey: "pk_demo",
      defaultLocale: "zh-CN",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.projects.set(project.id, project);
    this.inboxes.set("inbox_default", {
      id: "inbox_default",
      projectId: project.id,
      name: "Default Inbox",
      handoffProvider: "chatwoot"
    });
    this.adminKeyToProject.set(hash("admin_demo_key"), project.id);
    this.llmProviders.set("llm_demo", {
      id: "llm_demo",
      projectId: project.id,
      provider: "openai_compatible",
      baseUrl: "demo://local",
      model: "demo-support-model",
      embeddingModel: "demo-embedding",
      apiKeyEncrypted: "demo-local-key",
      status: "active",
      metadata: { demo: true }
    });

    const document: KnowledgeDocumentRecord = {
      id: "doc_demo_billing",
      projectId: project.id,
      title: "账单和订阅 FAQ",
      sourceType: "markdown",
      status: "indexed",
      metadata: { locale: "zh-CN" },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.knowledgeDocuments.set(document.id, document);

    for (const chunk of [
      {
        id: "chunk_demo_cancel_subscription",
        content:
          "用户可以在账单设置页面取消订阅。取消订阅后，当前计费周期仍然可以继续使用；周期结束后不会再次扣费。",
        metadata: { title: "取消订阅", source_uri: "demo://knowledge/billing" }
      },
      {
        id: "chunk_demo_refund",
        content:
          "退款问题需要人工审核。用户可以提供订单号和付款邮箱，客服会根据当前政策确认是否符合退款条件。",
        metadata: { title: "退款审核", source_uri: "demo://knowledge/billing" }
      }
    ]) {
      this.knowledgeChunks.set(chunk.id, {
        id: chunk.id,
        projectId: project.id,
        documentId: document.id,
        chunkIndex: this.knowledgeChunks.size,
        content: chunk.content,
        metadata: chunk.metadata,
        tokenCount: chunk.content.length
      });
    }
  }

  async findProjectByPublicKey(publicKey: string): Promise<ProjectRecord | undefined> {
    return [...this.projects.values()].find((project) => project.publicKey === publicKey);
  }

  async findProjectById(projectId: string): Promise<ProjectRecord | undefined> {
    return this.projects.get(projectId);
  }

  async findProjectByAdminKeyHash(keyHash: string): Promise<ProjectRecord | undefined> {
    const projectId = this.adminKeyToProject.get(keyHash);
    return projectId ? this.projects.get(projectId) : undefined;
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return [...this.projects.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const timestamp = now();
    const project: ProjectRecord = {
      id: id("proj"),
      organizationId: "org_demo",
      name: input.name,
      publicKey: `pk_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      defaultLocale: input.defaultLocale ?? "zh-CN",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.projects.set(project.id, project);
    const inboxId = id("inbox");
    this.inboxes.set(inboxId, {
      id: inboxId,
      projectId: project.id,
      name: "Default Inbox"
    });
    return project;
  }

  async findInbox(projectId: string, inboxId?: string): Promise<InboxRecord | undefined> {
    const inboxes = [...this.inboxes.values()].filter((inbox) => inbox.projectId === projectId);
    return inboxId ? inboxes.find((inbox) => inbox.id === inboxId) : inboxes[0];
  }

  async upsertContact(projectId: string, input: ContactInput): Promise<ContactRecord> {
    const existing = [...this.contacts.values()].find((contact) => {
      if (contact.projectId !== projectId) {
        return false;
      }
      return (
        (input.externalUserId && contact.externalUserId === input.externalUserId) ||
        (input.email && contact.email === input.email)
      );
    });

    if (existing) {
      const updated: ContactRecord = {
        ...existing,
        ...input,
        metadata: { ...existing.metadata, ...(input.metadata ?? {}) },
        updatedAt: now()
      };
      this.contacts.set(existing.id, updated);
      return updated;
    }

    const timestamp = now();
    const contact: ContactRecord = {
      id: id("contact"),
      projectId,
      ...input,
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.contacts.set(contact.id, contact);
    return contact;
  }

  async createConversation(input: {
    projectId: string;
    inboxId: string;
    contactId: string;
    metadata?: JsonRecord;
  }): Promise<ConversationRecord> {
    const timestamp = now();
    const conversation: ConversationRecord = {
      id: id("conv"),
      projectId: input.projectId,
      inboxId: input.inboxId,
      contactId: input.contactId,
      status: "open",
      assigneeType: "ai",
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async findConversation(
    projectId: string,
    conversationId: string
  ): Promise<ConversationRecord | undefined> {
    const conversation = this.conversations.get(conversationId);
    return conversation?.projectId === projectId ? conversation : undefined;
  }

  async listConversations(projectId: string): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.projectId === projectId)
      .sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
      );
  }

  async updateConversationStatus(input: {
    projectId: string;
    conversationId: string;
    status: ConversationRecord["status"];
    assigneeType?: ConversationRecord["assigneeType"];
  }): Promise<ConversationRecord> {
    const conversation = await this.requireConversation(input.projectId, input.conversationId);
    const updated: ConversationRecord = {
      ...conversation,
      status: input.status,
      assigneeType: input.assigneeType ?? conversation.assigneeType,
      updatedAt: now()
    };
    this.conversations.set(updated.id, updated);
    return updated;
  }

  async listMessages(projectId: string, conversationId: string): Promise<MessageRecord[]> {
    await this.requireConversation(projectId, conversationId);
    return [...this.messages.values()]
      .filter(
        (message) => message.projectId === projectId && message.conversationId === conversationId
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createMessage(input: {
    projectId: string;
    conversationId: string;
    message: CreateMessageInput;
  }): Promise<MessageRecord> {
    await this.requireConversation(input.projectId, input.conversationId);
    const message: MessageRecord = {
      id: id("msg"),
      projectId: input.projectId,
      conversationId: input.conversationId,
      role: input.message.role,
      visibility: input.message.visibility ?? "public",
      contentType: "text",
      content: {
        text: input.message.text
      },
      sourceRefs: input.message.sourceRefs,
      metadata: input.message.metadata ?? {},
      createdAt: now()
    };
    this.messages.set(message.id, message);
    const conversation = this.conversations.get(input.conversationId);
    if (conversation) {
      this.conversations.set(conversation.id, {
        ...conversation,
        lastMessageAt: message.createdAt,
        updatedAt: message.createdAt
      });
    }
    return message;
  }

  async createKnowledgeDocument(
    projectId: string,
    input: CreateKnowledgeDocumentInput
  ): Promise<KnowledgeDocumentRecord> {
    const timestamp = now();
    const document: KnowledgeDocumentRecord = {
      id: id("doc"),
      projectId,
      title: input.title,
      sourceType: input.sourceType,
      sourceUri: input.sourceUri,
      status: "indexed",
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.knowledgeDocuments.set(document.id, document);

    const chunks = chunkText(input.content);
    chunks.forEach((content, index) => {
      const chunk: KnowledgeChunkRecord = {
        id: id("chunk"),
        projectId,
        documentId: document.id,
        chunkIndex: index,
        content,
        tokenCount: content.length,
        metadata: {
          title: input.title,
          source_uri: input.sourceUri
        }
      };
      this.knowledgeChunks.set(chunk.id, chunk);
    });

    return document;
  }

  async listKnowledgeDocuments(projectId: string): Promise<KnowledgeDocumentRecord[]> {
    return [...this.knowledgeDocuments.values()]
      .filter((document) => document.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

    return [...this.knowledgeChunks.values()]
      .filter((chunk) => chunk.projectId === projectId)
      .map((chunk) => ({
        ...chunk,
        score: scoreChunk(chunk.content, terms)
      }))
      .filter((chunk) => (chunk.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

  async getActiveLlmProvider(projectId: string): Promise<LlmProviderRecord | undefined> {
    return [...this.llmProviders.values()].find(
      (provider) => provider.projectId === projectId && provider.status === "active"
    );
  }

  async upsertLlmProvider(
    input: Omit<LlmProviderRecord, "id" | "metadata"> & { id?: string; metadata?: JsonRecord }
  ): Promise<LlmProviderRecord> {
    const existing = [...this.llmProviders.values()].find(
      (provider) => provider.projectId === input.projectId
    );
    const provider: LlmProviderRecord = {
      id: existing?.id ?? input.id ?? id("llm"),
      projectId: input.projectId,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      embeddingModel: input.embeddingModel,
      apiKeyEncrypted: input.apiKeyEncrypted,
      status: input.status,
      metadata: input.metadata ?? existing?.metadata ?? {}
    };
    this.llmProviders.set(provider.id, provider);
    return provider;
  }

  async createAiRun(input: CreateAiRunInput): Promise<AiRunRecord> {
    const aiRun: AiRunRecord = {
      id: id("airun"),
      ...input,
      createdAt: now()
    };
    this.aiRuns.set(aiRun.id, aiRun);
    return aiRun;
  }

  async listAiRuns(projectId: string, conversationId?: string): Promise<AiRunRecord[]> {
    return [...this.aiRuns.values()]
      .filter((run) => run.projectId === projectId)
      .filter((run) => (conversationId ? run.conversationId === conversationId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createHandoffSession(input: {
    projectId: string;
    conversationId: string;
    provider: string;
    reason?: HandoffSessionRecord["reason"];
    metadata?: JsonRecord;
  }): Promise<HandoffSessionRecord> {
    const timestamp = now();
    const session: HandoffSessionRecord = {
      id: id("handoff"),
      projectId: input.projectId,
      conversationId: input.conversationId,
      provider: input.provider,
      reason: input.reason,
      status: "requested",
      metadata: input.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.handoffSessions.set(session.id, session);
    return session;
  }

  async upsertIntegrationConfig(input: {
    projectId: string;
    provider: string;
    status: "active" | "disabled";
    configEncrypted: string;
    metadata?: JsonRecord;
  }): Promise<IntegrationConfigRecord> {
    const existing = await this.getIntegrationConfig(input.projectId, input.provider);
    const timestamp = now();
    const config: IntegrationConfigRecord = {
      id: existing?.id ?? id("integration"),
      projectId: input.projectId,
      provider: input.provider,
      status: input.status,
      configEncrypted: input.configEncrypted,
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.integrationConfigs.set(config.id, config);
    return config;
  }

  async getIntegrationConfig(
    projectId: string,
    provider: string
  ): Promise<IntegrationConfigRecord | undefined> {
    return [...this.integrationConfigs.values()].find(
      (config) => config.projectId === projectId && config.provider === provider
    );
  }

  async createWebhookEvent(input: {
    projectId: string;
    provider: string;
    externalEventId?: string;
    payload: JsonRecord;
  }): Promise<WebhookEventRecord> {
    if (input.externalEventId) {
      const existing = [...this.webhookEvents.values()].find(
        (event) =>
          event.provider === input.provider && event.externalEventId === input.externalEventId
      );
      if (existing) {
        return existing;
      }
    }

    const event: WebhookEventRecord = {
      id: id("webhook"),
      projectId: input.projectId,
      provider: input.provider,
      externalEventId: input.externalEventId,
      payload: input.payload,
      status: "received",
      createdAt: now()
    };
    this.webhookEvents.set(event.id, event);
    return event;
  }

  async markWebhookEvent(input: {
    id: string;
    status: WebhookEventRecord["status"];
    error?: string;
  }): Promise<WebhookEventRecord> {
    const event = this.webhookEvents.get(input.id);
    if (!event) {
      throw new Error(`Webhook event not found: ${input.id}`);
    }
    const updated: WebhookEventRecord = {
      ...event,
      status: input.status,
      error: input.error,
      processedAt: now()
    };
    this.webhookEvents.set(updated.id, updated);
    return updated;
  }

  async findHandoffByExternalConversation(input: {
    projectId: string;
    provider: string;
    externalConversationId: string;
  }): Promise<HandoffSessionRecord | undefined> {
    return [...this.handoffSessions.values()].find(
      (session) =>
        session.projectId === input.projectId &&
        session.provider === input.provider &&
        session.externalConversationId === input.externalConversationId
    );
  }

  private async requireConversation(
    projectId: string,
    conversationId: string
  ): Promise<ConversationRecord> {
    const conversation = await this.findConversation(projectId, conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    return conversation;
  }
}
