import type {
  AiRunStatus,
  ConversationStatus,
  HandoffReason,
  Message,
  MessageRole,
  SourceReference
} from "@opensupportai/protocol";

export type JsonRecord = Record<string, unknown>;

export type ProjectRecord = {
  id: string;
  organizationId: string;
  name: string;
  publicKey: string;
  defaultLocale: string;
  createdAt: string;
  updatedAt: string;
};

export type InboxRecord = {
  id: string;
  projectId: string;
  name: string;
  handoffProvider?: string;
};

export type ContactInput = {
  externalUserId?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  metadata?: JsonRecord;
};

export type ContactRecord = ContactInput & {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationRecord = {
  id: string;
  projectId: string;
  inboxId: string;
  contactId: string;
  status: ConversationStatus;
  assigneeType: "ai" | "human" | "none";
  metadata: JsonRecord;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = Message & {
  projectId: string;
};

export type KnowledgeDocumentRecord = {
  id: string;
  projectId: string;
  title: string;
  sourceType: "markdown" | "text" | "url" | "pdf";
  sourceUri?: string;
  status: "pending" | "indexing" | "indexed" | "failed";
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunkRecord = {
  id: string;
  projectId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number;
  metadata: JsonRecord;
  score?: number;
};

export type LlmProviderRecord = {
  id: string;
  projectId: string;
  provider: "openai_compatible";
  baseUrl: string;
  model: string;
  embeddingModel?: string;
  apiKeyEncrypted: string;
  status: "active" | "disabled";
  metadata: JsonRecord;
};

export type AiRunRecord = {
  id: string;
  projectId: string;
  conversationId: string;
  messageId?: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  retrievedChunkIds: string[];
  confidence?: number;
  status: AiRunStatus;
  error?: string;
  metadata: JsonRecord;
  createdAt: string;
};

export type HandoffSessionRecord = {
  id: string;
  projectId: string;
  conversationId: string;
  provider: string;
  externalContactId?: string;
  externalConversationId?: string;
  status: "requested" | "active" | "closed" | "failed";
  reason?: HandoffReason;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationConfigRecord = {
  id: string;
  projectId: string;
  provider: string;
  status: "active" | "disabled";
  configEncrypted: string;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type WebhookEventRecord = {
  id: string;
  projectId: string;
  provider: string;
  externalEventId?: string;
  payload: JsonRecord;
  status: "received" | "processed" | "failed" | "ignored";
  error?: string;
  createdAt: string;
  processedAt?: string;
};

export type CreateMessageInput = {
  role: MessageRole;
  text: string;
  visibility?: "public" | "internal_note" | "debug_trace";
  sourceRefs?: SourceReference[];
  metadata?: JsonRecord;
};

export type CreateAiRunInput = Omit<AiRunRecord, "id" | "createdAt">;

export type CreateKnowledgeDocumentInput = {
  title: string;
  sourceType: "markdown" | "text" | "url" | "pdf";
  content: string;
  sourceUri?: string;
  metadata?: JsonRecord;
};

export type CreateProjectInput = {
  name: string;
  defaultLocale?: string;
};

export type SupportRepository = {
  seedDemo(): Promise<void>;
  findProjectByPublicKey(publicKey: string): Promise<ProjectRecord | undefined>;
  findProjectById(projectId: string): Promise<ProjectRecord | undefined>;
  findProjectByAdminKeyHash(keyHash: string): Promise<ProjectRecord | undefined>;
  listProjects(): Promise<ProjectRecord[]>;
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  findInbox(projectId: string, inboxId?: string): Promise<InboxRecord | undefined>;
  upsertContact(projectId: string, input: ContactInput): Promise<ContactRecord>;
  createConversation(input: {
    projectId: string;
    inboxId: string;
    contactId: string;
    metadata?: JsonRecord;
  }): Promise<ConversationRecord>;
  findConversation(
    projectId: string,
    conversationId: string
  ): Promise<ConversationRecord | undefined>;
  listConversations(projectId: string): Promise<ConversationRecord[]>;
  updateConversationStatus(input: {
    projectId: string;
    conversationId: string;
    status: ConversationStatus;
    assigneeType?: ConversationRecord["assigneeType"];
  }): Promise<ConversationRecord>;
  listMessages(projectId: string, conversationId: string): Promise<MessageRecord[]>;
  createMessage(input: {
    projectId: string;
    conversationId: string;
    message: CreateMessageInput;
  }): Promise<MessageRecord>;
  createKnowledgeDocument(
    projectId: string,
    input: CreateKnowledgeDocumentInput
  ): Promise<KnowledgeDocumentRecord>;
  listKnowledgeDocuments(projectId: string): Promise<KnowledgeDocumentRecord[]>;
  retrieveKnowledge(
    projectId: string,
    query: string,
    limit: number
  ): Promise<KnowledgeChunkRecord[]>;
  getActiveLlmProvider(projectId: string): Promise<LlmProviderRecord | undefined>;
  upsertLlmProvider(
    input: Omit<LlmProviderRecord, "id" | "metadata"> & { id?: string; metadata?: JsonRecord }
  ): Promise<LlmProviderRecord>;
  createAiRun(input: CreateAiRunInput): Promise<AiRunRecord>;
  listAiRuns(projectId: string, conversationId?: string): Promise<AiRunRecord[]>;
  createHandoffSession(input: {
    projectId: string;
    conversationId: string;
    provider: string;
    reason?: HandoffReason;
    metadata?: JsonRecord;
  }): Promise<HandoffSessionRecord>;
  upsertIntegrationConfig(input: {
    projectId: string;
    provider: string;
    status: "active" | "disabled";
    configEncrypted: string;
    metadata?: JsonRecord;
  }): Promise<IntegrationConfigRecord>;
  getIntegrationConfig(
    projectId: string,
    provider: string
  ): Promise<IntegrationConfigRecord | undefined>;
  createWebhookEvent(input: {
    projectId: string;
    provider: string;
    externalEventId?: string;
    payload: JsonRecord;
  }): Promise<WebhookEventRecord>;
  markWebhookEvent(input: {
    id: string;
    status: WebhookEventRecord["status"];
    error?: string;
  }): Promise<WebhookEventRecord>;
  findHandoffByExternalConversation(input: {
    projectId: string;
    provider: string;
    externalConversationId: string;
  }): Promise<HandoffSessionRecord | undefined>;
};
