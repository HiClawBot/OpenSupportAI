import { createHash, randomUUID } from "node:crypto";
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
  ConversationRecord,
  ConversationInsightRecord,
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
  private readonly knowledgeDocumentContent = new Map<string, string>();
  private readonly knowledgeChunks = new Map<string, KnowledgeChunkRecord>();
  private readonly llmProviders = new Map<string, LlmProviderRecord>();
  private readonly aiRuns = new Map<string, AiRunRecord>();
  private readonly handoffSessions = new Map<string, HandoffSessionRecord>();
  private readonly integrationConfigs = new Map<string, IntegrationConfigRecord>();
  private readonly webhookEvents = new Map<string, WebhookEventRecord>();
  private readonly apiKeys = new Map<string, ApiKeyRecord>();
  private readonly auditLogs = new Map<string, AuditLogRecord>();
  private readonly toolDefinitions = new Map<string, ToolDefinitionRecord>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  private readonly conversationInsights = new Map<string, ConversationInsightRecord>();
  private readonly asyncJobs = new Map<string, AsyncJobRecord>();

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
    this.apiKeys.set("key_demo_admin", {
      id: "key_demo_admin",
      projectId: project.id,
      organizationId: project.organizationId,
      name: "Demo Admin Key",
      keyHash: hash("admin_demo_key"),
      scopes: ["admin:*"],
      createdAt: timestamp
    });
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
    for (const tool of demoToolDefinitions(project.id, timestamp)) {
      this.toolDefinitions.set(tool.id, tool);
    }

    const demoKnowledgeContent = [
      "用户可以在账单设置页面取消订阅。取消订阅后，当前计费周期仍然可以继续使用；周期结束后不会再次扣费。",
      "退款问题需要人工审核。用户可以提供订单号和付款邮箱，客服会根据当前政策确认是否符合退款条件。"
    ].join("\n\n");
    const document: KnowledgeDocumentRecord = {
      id: "doc_demo_billing",
      projectId: project.id,
      title: "账单和订阅 FAQ",
      sourceType: "markdown",
      status: "indexed",
      contentHash: hash(demoKnowledgeContent),
      metadata: { locale: "zh-CN", chunk_count: 2 },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.knowledgeDocuments.set(document.id, document);
    this.knowledgeDocumentContent.set(document.id, demoKnowledgeContent);

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
    const lookup = await this.findAdminApiKeyByHash(keyHash);
    return lookup?.project;
  }

  async findAdminApiKeyByHash(keyHash: string): Promise<AdminApiKeyLookup | undefined> {
    const apiKey = [...this.apiKeys.values()].find(
      (candidate) => candidate.keyHash === keyHash && !candidate.revokedAt
    );
    if (!apiKey) {
      return undefined;
    }

    return {
      apiKey,
      project: apiKey.projectId ? this.projects.get(apiKey.projectId) : undefined
    };
  }

  async touchApiKeyLastUsed(id: string, timestamp = now()): Promise<void> {
    const apiKey = this.apiKeys.get(id);
    if (!apiKey) {
      return;
    }
    this.apiKeys.set(id, {
      ...apiKey,
      lastUsedAt: timestamp
    });
  }

  async createApiKey(input: {
    projectId: string;
    organizationId?: string;
    name: string;
    keyHash: string;
    scopes: string[];
  }): Promise<ApiKeyRecord> {
    const project = await this.requireProject(input.projectId);
    const apiKey: ApiKeyRecord = {
      id: id("key"),
      projectId: input.projectId,
      organizationId: input.organizationId ?? project.organizationId,
      name: input.name,
      keyHash: input.keyHash,
      scopes: input.scopes,
      createdAt: now()
    };
    this.apiKeys.set(apiKey.id, apiKey);
    return apiKey;
  }

  async listApiKeys(input: {
    projectId: string;
    includeRevoked?: boolean;
  }): Promise<ApiKeyRecord[]> {
    return [...this.apiKeys.values()]
      .filter((apiKey) => apiKey.projectId === input.projectId)
      .filter((apiKey) => (input.includeRevoked ? true : !apiKey.revokedAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeApiKey(input: { projectId: string; id: string }): Promise<ApiKeyRecord> {
    const apiKey = this.requireApiKey(input.projectId, input.id);
    const revoked: ApiKeyRecord = {
      ...apiKey,
      revokedAt: apiKey.revokedAt ?? now()
    };
    this.apiKeys.set(revoked.id, revoked);
    return revoked;
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

  async findContact(projectId: string, contactId: string): Promise<ContactRecord | undefined> {
    const contact = this.contacts.get(contactId);
    return contact?.projectId === projectId ? contact : undefined;
  }

  async upsertContact(projectId: string, input: ContactInput): Promise<ContactRecord> {
    const normalizedInput = {
      ...input,
      email: input.email?.trim().toLowerCase()
    };
    const existing = [...this.contacts.values()].find((contact) => {
      if (contact.projectId !== projectId) {
        return false;
      }
      return (
        (normalizedInput.externalUserId &&
          contact.externalUserId === normalizedInput.externalUserId) ||
        (normalizedInput.email && contact.email === normalizedInput.email)
      );
    });

    if (existing) {
      const updated: ContactRecord = {
        ...existing,
        ...normalizedInput,
        metadata: { ...existing.metadata, ...(normalizedInput.metadata ?? {}) },
        updatedAt: now()
      };
      this.contacts.set(existing.id, updated);
      return updated;
    }

    const timestamp = now();
    const contact: ContactRecord = {
      id: id("contact"),
      projectId,
      ...normalizedInput,
      metadata: normalizedInput.metadata ?? {},
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

  async createIdempotentConversation(input: {
    projectId: string;
    inboxId: string;
    contactId: string;
    idempotencyKey: string;
    idempotencyHash: string;
    metadata?: JsonRecord;
  }): Promise<{ conversation: ConversationRecord; created: boolean }> {
    const existing = [...this.conversations.values()].find(
      (conversation) =>
        conversation.projectId === input.projectId &&
        conversation.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      assertMatchingIdempotencyHash(existing.idempotencyHash, input.idempotencyHash);
      return { conversation: existing, created: false };
    }
    const conversation = await this.createConversation(input);
    const idempotentConversation: ConversationRecord = {
      ...conversation,
      idempotencyKey: input.idempotencyKey,
      idempotencyHash: input.idempotencyHash
    };
    this.conversations.set(conversation.id, idempotentConversation);
    return { conversation: idempotentConversation, created: true };
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

  async listMessages(
    projectId: string,
    conversationId: string,
    options: { limit?: number; after?: string } = {}
  ): Promise<MessageRecord[]> {
    await this.requireConversation(projectId, conversationId);
    const messages = [...this.messages.values()]
      .filter(
        (message) => message.projectId === projectId && message.conversationId === conversationId
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const cursorIndex = options.after
      ? messages.findIndex((message) => message.id === options.after)
      : -1;
    if (options.after && cursorIndex < 0) {
      return [];
    }
    return messages.slice(cursorIndex + 1, cursorIndex + 1 + boundedMessageLimit(options.limit));
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

  async createIdempotentMessage(input: {
    projectId: string;
    conversationId: string;
    idempotencyKey: string;
    idempotencyHash: string;
    message: CreateMessageInput;
  }): Promise<{ message: MessageRecord; created: boolean }> {
    const existing = [...this.messages.values()].find(
      (message) =>
        message.conversationId === input.conversationId &&
        message.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      assertMatchingIdempotencyHash(existing.idempotencyHash, input.idempotencyHash);
      return { message: existing, created: false };
    }
    const message = await this.createMessage(input);
    const idempotentMessage: MessageRecord = {
      ...message,
      idempotencyKey: input.idempotencyKey,
      idempotencyHash: input.idempotencyHash
    };
    this.messages.set(message.id, idempotentMessage);
    return { message: idempotentMessage, created: true };
  }

  async createKnowledgeDocument(
    projectId: string,
    input: CreateKnowledgeDocumentInput
  ): Promise<KnowledgeDocumentRecord> {
    const timestamp = now();
    const chunks = chunkText(input.content);
    const document: KnowledgeDocumentRecord = {
      id: id("doc"),
      projectId,
      title: input.title,
      sourceType: input.sourceType,
      sourceUri: input.sourceUri,
      status: "indexed",
      contentHash: hash(input.content),
      metadata: {
        ...(input.metadata ?? {}),
        chunk_count: chunks.length,
        indexed_at: timestamp
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.knowledgeDocuments.set(document.id, document);
    this.knowledgeDocumentContent.set(document.id, input.content);

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

  async findKnowledgeDocument(
    projectId: string,
    documentId: string
  ): Promise<KnowledgeDocumentRecord | undefined> {
    const document = this.knowledgeDocuments.get(documentId);
    return document?.projectId === projectId ? document : undefined;
  }

  async updateKnowledgeDocumentIndexState(input: {
    projectId: string;
    documentId: string;
    status: KnowledgeDocumentRecord["status"];
    metadata?: JsonRecord;
    error?: string;
  }): Promise<KnowledgeDocumentRecord> {
    const document = await this.findKnowledgeDocument(input.projectId, input.documentId);
    if (!document) {
      throw new Error(`Knowledge document not found: ${input.documentId}`);
    }
    const updated: KnowledgeDocumentRecord = {
      ...document,
      status: input.status,
      metadata: input.metadata ?? document.metadata,
      error: input.error,
      updatedAt: now()
    };
    this.knowledgeDocuments.set(updated.id, updated);
    return updated;
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

  async updateHandoffSession(input: {
    id: string;
    status?: HandoffSessionRecord["status"];
    externalContactId?: string;
    externalConversationId?: string;
    metadata?: JsonRecord;
  }): Promise<HandoffSessionRecord> {
    const session = this.handoffSessions.get(input.id);
    if (!session) {
      throw new Error(`Handoff session not found: ${input.id}`);
    }

    const updated: HandoffSessionRecord = {
      ...session,
      status: input.status ?? session.status,
      externalContactId: input.externalContactId ?? session.externalContactId,
      externalConversationId: input.externalConversationId ?? session.externalConversationId,
      metadata: input.metadata ?? session.metadata,
      updatedAt: now()
    };
    this.handoffSessions.set(updated.id, updated);
    return updated;
  }

  async findHandoffSession(input: {
    projectId: string;
    id: string;
  }): Promise<HandoffSessionRecord | undefined> {
    const session = this.handoffSessions.get(input.id);
    return session?.projectId === input.projectId ? session : undefined;
  }

  async listHandoffSessions(input: {
    projectId: string;
    conversationId?: string;
  }): Promise<HandoffSessionRecord[]> {
    return [...this.handoffSessions.values()]
      .filter((session) => session.projectId === input.projectId)
      .filter((session) =>
        input.conversationId ? session.conversationId === input.conversationId : true
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
          event.projectId === input.projectId &&
          event.provider === input.provider &&
          event.externalEventId === input.externalEventId
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
      attempts: 0,
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
      processedAt: ["processed", "failed", "ignored"].includes(input.status) ? now() : undefined
    };
    this.webhookEvents.set(updated.id, updated);
    return updated;
  }

  async claimWebhookEvent(input: {
    projectId: string;
    id: string;
    now?: string;
  }): Promise<{ event: WebhookEventRecord; claimed: boolean }> {
    const event = this.webhookEvents.get(input.id);
    if (!event || event.projectId !== input.projectId) {
      throw new Error(`Webhook event not found: ${input.id}`);
    }
    if (event.status !== "received") {
      return { event, claimed: false };
    }
    const updated: WebhookEventRecord = {
      ...event,
      status: "processing",
      attempts: event.attempts + 1,
      processingStartedAt: input.now ?? now(),
      processedAt: undefined,
      error: undefined
    };
    this.webhookEvents.set(updated.id, updated);
    return { event: updated, claimed: true };
  }

  async findWebhookEvent(input: {
    projectId: string;
    id: string;
  }): Promise<WebhookEventRecord | undefined> {
    const event = this.webhookEvents.get(input.id);
    return event?.projectId === input.projectId ? event : undefined;
  }

  async listWebhookEvents(input: {
    projectId: string;
    provider?: string;
    status?: WebhookEventRecord["status"];
    limit?: number;
  }): Promise<WebhookEventRecord[]> {
    return [...this.webhookEvents.values()]
      .filter((event) => event.projectId === input.projectId)
      .filter((event) => (input.provider ? event.provider === input.provider : true))
      .filter((event) => (input.status ? event.status === input.status : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 50);
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
    const auditLog: AuditLogRecord = {
      id: id("audit"),
      projectId: input.projectId,
      organizationId: input.organizationId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
      requestId: input.requestId,
      createdAt: now()
    };
    this.auditLogs.set(auditLog.id, auditLog);
    return auditLog;
  }

  async listAuditLogs(input: {
    projectId: string;
    action?: string;
    limit?: number;
  }): Promise<AuditLogRecord[]> {
    return [...this.auditLogs.values()]
      .filter((auditLog) => auditLog.projectId === input.projectId)
      .filter((auditLog) => (input.action ? auditLog.action === input.action : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 100);
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
    await this.requireProject(input.projectId);
    const existing = [...this.toolDefinitions.values()].find(
      (tool) => tool.projectId === input.projectId && tool.slug === input.slug
    );
    const timestamp = now();
    const tool: ToolDefinitionRecord = {
      id: existing?.id ?? id("tool"),
      projectId: input.projectId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      kind: input.kind,
      status: input.status,
      method: input.method,
      path: input.path,
      inputSchema: input.inputSchema ?? existing?.inputSchema ?? {},
      outputSchema: input.outputSchema ?? existing?.outputSchema ?? {},
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.toolDefinitions.set(tool.id, tool);
    return tool;
  }

  async listToolDefinitions(input: {
    projectId: string;
    status?: ToolDefinitionRecord["status"];
    limit?: number;
  }): Promise<ToolDefinitionRecord[]> {
    return [...this.toolDefinitions.values()]
      .filter((tool) => tool.projectId === input.projectId)
      .filter((tool) => (input.status ? tool.status === input.status : true))
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .slice(0, input.limit ?? 100);
  }

  async findToolDefinitionBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<ToolDefinitionRecord | undefined> {
    return [...this.toolDefinitions.values()].find(
      (tool) => tool.projectId === input.projectId && tool.slug === input.slug
    );
  }

  async updateToolDefinitionStatus(input: {
    projectId: string;
    id: string;
    status: ToolDefinitionRecord["status"];
  }): Promise<ToolDefinitionRecord> {
    const tool = this.requireToolDefinition(input.projectId, input.id);
    const updated: ToolDefinitionRecord = {
      ...tool,
      status: input.status,
      updatedAt: now()
    };
    this.toolDefinitions.set(updated.id, updated);
    return updated;
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
    const toolCall: ToolCallRecord = {
      id: id("toolcall"),
      projectId: input.projectId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      toolId: input.toolId,
      toolSlug: input.toolSlug,
      status: input.status,
      input: input.input ?? {},
      output: input.output,
      error: input.error,
      latencyMs: input.latencyMs,
      createdAt: now()
    };
    this.toolCalls.set(toolCall.id, toolCall);
    return toolCall;
  }

  async listToolCalls(input: {
    projectId: string;
    conversationId?: string;
    limit?: number;
  }): Promise<ToolCallRecord[]> {
    return [...this.toolCalls.values()]
      .filter((toolCall) => toolCall.projectId === input.projectId)
      .filter((toolCall) =>
        input.conversationId ? toolCall.conversationId === input.conversationId : true
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 100);
  }

  async getConversationInsight(input: {
    projectId: string;
    conversationId: string;
  }): Promise<ConversationInsightRecord | undefined> {
    const insight = this.conversationInsights.get(input.conversationId);
    return insight?.projectId === input.projectId ? insight : undefined;
  }

  async upsertConversationInsight(input: {
    projectId: string;
    conversationId: string;
    summary: string;
    suggestedReplies: string[];
    tags: string[];
    metadata?: JsonRecord;
  }): Promise<ConversationInsightRecord> {
    await this.requireConversation(input.projectId, input.conversationId);
    const existing = this.conversationInsights.get(input.conversationId);
    const timestamp = now();
    const insight: ConversationInsightRecord = {
      id: existing?.id ?? id("insight"),
      projectId: input.projectId,
      conversationId: input.conversationId,
      summary: input.summary,
      suggestedReplies: input.suggestedReplies,
      tags: input.tags,
      metadata: input.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.conversationInsights.set(input.conversationId, insight);
    return insight;
  }

  async createAsyncJob(input: {
    projectId: string;
    type: string;
    payload?: JsonRecord;
    runAt?: string;
    maxAttempts?: number;
  }): Promise<AsyncJobRecord> {
    await this.requireProject(input.projectId);
    const timestamp = now();
    const job: AsyncJobRecord = {
      id: id("job"),
      projectId: input.projectId,
      type: input.type,
      status: "queued",
      payload: input.payload ?? {},
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      runAt: input.runAt ?? timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.asyncJobs.set(job.id, job);
    return job;
  }

  async listAsyncJobs(input: {
    projectId: string;
    status?: AsyncJobStatus;
    type?: string;
    limit?: number;
  }): Promise<AsyncJobRecord[]> {
    return [...this.asyncJobs.values()]
      .filter((job) => job.projectId === input.projectId)
      .filter((job) => (input.status ? job.status === input.status : true))
      .filter((job) => (input.type ? job.type === input.type : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 50);
  }

  async claimNextAsyncJob(input: {
    workerId: string;
    types?: string[];
    now?: string;
    leaseMs?: number;
  }): Promise<AsyncJobRecord | undefined> {
    const timestamp = input.now ?? now();
    for (const running of this.asyncJobs.values()) {
      if (
        running.status === "running" &&
        running.leaseExpiresAt &&
        running.leaseExpiresAt <= timestamp &&
        running.attempts >= running.maxAttempts
      ) {
        this.asyncJobs.set(running.id, {
          ...running,
          status: "failed",
          lockedBy: undefined,
          lockedAt: undefined,
          leaseExpiresAt: undefined,
          error: "Job lease expired after the maximum number of attempts",
          updatedAt: timestamp
        });
      }
    }
    const job = [...this.asyncJobs.values()]
      .filter(
        (candidate) =>
          (candidate.status === "queued" && candidate.runAt <= timestamp) ||
          (candidate.status === "running" &&
            Boolean(candidate.leaseExpiresAt && candidate.leaseExpiresAt <= timestamp))
      )
      .filter((candidate) => candidate.attempts < candidate.maxAttempts)
      .filter((candidate) => (input.types?.length ? input.types.includes(candidate.type) : true))
      .sort((a, b) => a.runAt.localeCompare(b.runAt) || a.createdAt.localeCompare(b.createdAt))[0];
    if (!job) {
      return undefined;
    }

    const updated: AsyncJobRecord = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      lockedBy: input.workerId,
      lockedAt: timestamp,
      leaseExpiresAt: new Date(
        new Date(timestamp).getTime() + (input.leaseMs ?? 60_000)
      ).toISOString(),
      updatedAt: timestamp
    };
    this.asyncJobs.set(updated.id, updated);
    return updated;
  }

  async renewAsyncJobLease(input: {
    id: string;
    workerId: string;
    now?: string;
    leaseMs?: number;
  }): Promise<AsyncJobRecord> {
    const job = this.requireOwnedAsyncJob(input.id, input.workerId);
    const timestamp = input.now ?? now();
    const updated: AsyncJobRecord = {
      ...job,
      leaseExpiresAt: new Date(
        new Date(timestamp).getTime() + (input.leaseMs ?? 60_000)
      ).toISOString(),
      updatedAt: timestamp
    };
    this.asyncJobs.set(updated.id, updated);
    return updated;
  }

  async completeAsyncJob(input: {
    id: string;
    workerId: string;
    result?: JsonRecord;
  }): Promise<AsyncJobRecord> {
    const job = this.requireOwnedAsyncJob(input.id, input.workerId);
    const timestamp = now();
    const updated: AsyncJobRecord = {
      ...job,
      status: "completed",
      result: input.result ?? {},
      lockedBy: undefined,
      lockedAt: undefined,
      leaseExpiresAt: undefined,
      error: undefined,
      updatedAt: timestamp
    };
    this.asyncJobs.set(updated.id, updated);
    return updated;
  }

  async failAsyncJob(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt?: string;
  }): Promise<AsyncJobRecord> {
    const job = this.requireOwnedAsyncJob(input.id, input.workerId);
    const timestamp = now();
    const shouldRetry = Boolean(input.retryAt) && job.attempts < job.maxAttempts;
    const updated: AsyncJobRecord = {
      ...job,
      status: shouldRetry ? "queued" : "failed",
      runAt: shouldRetry ? (input.retryAt ?? job.runAt) : job.runAt,
      lockedBy: undefined,
      lockedAt: undefined,
      leaseExpiresAt: undefined,
      error: input.error,
      updatedAt: timestamp
    };
    this.asyncJobs.set(updated.id, updated);
    return updated;
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

  private async requireProject(projectId: string): Promise<ProjectRecord> {
    const project = await this.findProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireApiKey(projectId: string, keyId: string): ApiKeyRecord {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey || apiKey.projectId !== projectId) {
      throw new Error(`API key not found: ${keyId}`);
    }
    return apiKey;
  }

  private requireToolDefinition(projectId: string, toolId: string): ToolDefinitionRecord {
    const tool = this.toolDefinitions.get(toolId);
    if (!tool || tool.projectId !== projectId) {
      throw new Error(`Tool definition not found: ${toolId}`);
    }
    return tool;
  }

  private requireAsyncJob(jobId: string): AsyncJobRecord {
    const job = this.asyncJobs.get(jobId);
    if (!job) {
      throw new Error(`Async job not found: ${jobId}`);
    }
    return job;
  }

  private requireOwnedAsyncJob(jobId: string, workerId: string): AsyncJobRecord {
    const job = this.requireAsyncJob(jobId);
    if (job.status !== "running" || job.lockedBy !== workerId) {
      throw new Error(`Async job lease is not owned by this worker: ${jobId}`);
    }
    return job;
  }
}

function boundedMessageLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 200, 201));
}

function assertMatchingIdempotencyHash(existing: string | undefined, requested: string): void {
  if (existing !== requested) {
    throw new IdempotencyConflictError(
      "Idempotency key was already used with a different request payload"
    );
  }
}

function demoToolDefinitions(projectId: string, timestamp: string): ToolDefinitionRecord[] {
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
      },
      createdAt: timestamp,
      updatedAt: timestamp
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
      },
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}
