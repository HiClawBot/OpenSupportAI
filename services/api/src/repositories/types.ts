import type {
  AiRunStatus,
  ConversationStatus,
  HandoffReason,
  Message,
  MessageRole,
  SourceReference,
  ToolCallStatus,
  ToolDefinitionKind,
  ToolDefinitionStatus
} from "@opensupportai/protocol";
import type {
  EvaluationObservation,
  EvaluationScenarioResult,
  EvaluationThresholds,
  GoldenScenarioCategory
} from "@opensupportai/evals";

export type JsonRecord = Record<string, unknown>;

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class GovernanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceConflictError";
  }
}

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
  idempotencyKey?: string;
  idempotencyHash?: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = Message & {
  projectId: string;
  idempotencyKey?: string;
  idempotencyHash?: string;
};

export type KnowledgeDocumentRecord = {
  id: string;
  projectId: string;
  title: string;
  sourceType: "markdown" | "text" | "url" | "pdf";
  sourceUri?: string;
  status: "pending" | "indexing" | "indexed" | "failed";
  contentHash?: string;
  metadata: JsonRecord;
  error?: string;
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
  status: "received" | "processing" | "processed" | "failed" | "ignored";
  error?: string;
  attempts: number;
  createdAt: string;
  processedAt?: string;
  processingStartedAt?: string;
};

export type ApiKeyRecord = {
  id: string;
  projectId?: string;
  organizationId?: string;
  name: string;
  keyHash: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
};

export type AdminApiKeyLookup = {
  apiKey: ApiKeyRecord;
  project?: ProjectRecord;
};

export type AuditLogRecord = {
  id: string;
  projectId?: string;
  organizationId?: string;
  actorType: "root_admin" | "api_key" | "system";
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata: JsonRecord;
  requestId?: string;
  createdAt: string;
};

export type ToolDefinitionRecord = {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  description: string;
  kind: ToolDefinitionKind;
  status: ToolDefinitionStatus;
  method?: string;
  path?: string;
  inputSchema: JsonRecord;
  outputSchema: JsonRecord;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type ToolCallRecord = {
  id: string;
  projectId: string;
  conversationId?: string;
  messageId?: string;
  toolId?: string;
  toolSlug: string;
  status: ToolCallStatus;
  input: JsonRecord;
  output?: JsonRecord;
  error?: string;
  latencyMs?: number;
  createdAt: string;
};

export type ConversationInsightRecord = {
  id: string;
  projectId: string;
  conversationId: string;
  summary: string;
  suggestedReplies: string[];
  tags: string[];
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type AsyncJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AsyncJobRecord = {
  id: string;
  projectId: string;
  type: string;
  deduplicationKey?: string;
  status: AsyncJobStatus;
  payload: JsonRecord;
  result?: JsonRecord;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedBy?: string;
  lockedAt?: string;
  leaseExpiresAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type EvaluationSuiteStatus = "draft" | "active" | "retired";

export type EvaluationScenarioRecord = {
  id: string;
  projectId: string;
  suiteId: string;
  slug: string;
  category: GoldenScenarioCategory;
  critical: boolean;
  input: JsonRecord;
  expectations: JsonRecord;
  metadata: JsonRecord;
  orderIndex: number;
  createdAt: string;
};

export type EvaluationSuiteRecord = {
  id: string;
  projectId: string;
  slug: string;
  version: number;
  name: string;
  status: EvaluationSuiteStatus;
  evaluatorVersion: string;
  thresholds: EvaluationThresholds;
  metadata: JsonRecord;
  createdBy?: string;
  activatedAt?: string;
  createdAt: string;
  scenarios: EvaluationScenarioRecord[];
};

export type EvaluationResultRecord = {
  id: string;
  projectId: string;
  runId: string;
  scenarioId?: string;
  scenarioSlug: string;
  category: GoldenScenarioCategory;
  critical: boolean;
  status: "passed" | "failed";
  score: number;
  outcome: string;
  assertions: EvaluationScenarioResult["assertions"];
  observed: EvaluationObservation;
  error?: string;
  createdAt: string;
};

export type EvaluationRunRecord = {
  id: string;
  projectId: string;
  suiteId: string;
  suiteVersion: number;
  status: "passed" | "failed";
  evaluatorVersion: string;
  thresholds: EvaluationThresholds;
  score: number;
  passRate: number;
  passedCount: number;
  failedCount: number;
  criticalFailures: string[];
  summary: JsonRecord;
  createdBy?: string;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  results: EvaluationResultRecord[];
};

export type EvaluationRunSummaryRecord = Omit<EvaluationRunRecord, "results">;

export type EvolutionProposalKind = "knowledge" | "prompt" | "tool";
export type EvolutionProposalStatus =
  | "draft"
  | "approved"
  | "regression_passed"
  | "canary"
  | "promoted"
  | "rejected"
  | "rolled_back";

export type EvolutionProposalRecord = {
  id: string;
  projectId: string;
  sourceRunId: string;
  regressionRunId?: string;
  kind: EvolutionProposalKind;
  status: EvolutionProposalStatus;
  title: string;
  rationale: string;
  artifact: JsonRecord;
  artifactHash: string;
  baseline: JsonRecord;
  canaryEvidence?: JsonRecord;
  rollbackTarget?: JsonRecord;
  reviewNote?: string;
  createdBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  promotedAt?: string;
  rolledBackAt?: string;
  createdAt: string;
  updatedAt: string;
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
  findAdminApiKeyByHash(keyHash: string): Promise<AdminApiKeyLookup | undefined>;
  touchApiKeyLastUsed(id: string, timestamp?: string): Promise<void>;
  createApiKey(input: {
    projectId: string;
    organizationId?: string;
    name: string;
    keyHash: string;
    scopes: string[];
  }): Promise<ApiKeyRecord>;
  listApiKeys(input: { projectId: string; includeRevoked?: boolean }): Promise<ApiKeyRecord[]>;
  revokeApiKey(input: { projectId: string; id: string }): Promise<ApiKeyRecord>;
  listProjects(): Promise<ProjectRecord[]>;
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  findInbox(projectId: string, inboxId?: string): Promise<InboxRecord | undefined>;
  findContact(projectId: string, contactId: string): Promise<ContactRecord | undefined>;
  upsertContact(projectId: string, input: ContactInput): Promise<ContactRecord>;
  createConversation(input: {
    projectId: string;
    inboxId: string;
    contactId: string;
    metadata?: JsonRecord;
  }): Promise<ConversationRecord>;
  createIdempotentConversation(input: {
    projectId: string;
    inboxId: string;
    contactId: string;
    idempotencyKey: string;
    idempotencyHash: string;
    metadata?: JsonRecord;
  }): Promise<{ conversation: ConversationRecord; created: boolean }>;
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
  listMessages(
    projectId: string,
    conversationId: string,
    options?: { limit?: number; after?: string }
  ): Promise<MessageRecord[]>;
  findMessage(
    projectId: string,
    conversationId: string,
    messageId: string
  ): Promise<MessageRecord | undefined>;
  findMessageByIdempotencyKey(input: {
    projectId: string;
    conversationId: string;
    idempotencyKey: string;
  }): Promise<MessageRecord | undefined>;
  findLatestMessage(projectId: string, conversationId: string): Promise<MessageRecord | undefined>;
  createMessage(input: {
    projectId: string;
    conversationId: string;
    message: CreateMessageInput;
  }): Promise<MessageRecord>;
  createIdempotentMessage(input: {
    projectId: string;
    conversationId: string;
    idempotencyKey: string;
    idempotencyHash: string;
    message: CreateMessageInput;
  }): Promise<{ message: MessageRecord; created: boolean }>;
  createMessageWithAsyncJob(input: {
    projectId: string;
    conversationId: string;
    idempotencyKey?: string;
    idempotencyHash?: string;
    message: CreateMessageInput;
    job: {
      type: string;
      payload?: JsonRecord;
      maxAttempts?: number;
    };
  }): Promise<{ message: MessageRecord; job: AsyncJobRecord; created: boolean }>;
  createKnowledgeDocument(
    projectId: string,
    input: CreateKnowledgeDocumentInput
  ): Promise<KnowledgeDocumentRecord>;
  listKnowledgeDocuments(projectId: string): Promise<KnowledgeDocumentRecord[]>;
  findKnowledgeDocument(
    projectId: string,
    documentId: string
  ): Promise<KnowledgeDocumentRecord | undefined>;
  updateKnowledgeDocumentIndexState(input: {
    projectId: string;
    documentId: string;
    status: KnowledgeDocumentRecord["status"];
    metadata?: JsonRecord;
    error?: string;
  }): Promise<KnowledgeDocumentRecord>;
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
  updateHandoffSession(input: {
    id: string;
    status?: HandoffSessionRecord["status"];
    externalContactId?: string;
    externalConversationId?: string;
    metadata?: JsonRecord;
  }): Promise<HandoffSessionRecord>;
  findHandoffSession(input: {
    projectId: string;
    id: string;
  }): Promise<HandoffSessionRecord | undefined>;
  listHandoffSessions(input: {
    projectId: string;
    conversationId?: string;
  }): Promise<HandoffSessionRecord[]>;
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
  claimWebhookEvent(input: {
    projectId: string;
    id: string;
    now?: string;
  }): Promise<{ event: WebhookEventRecord; claimed: boolean }>;
  findWebhookEvent(input: {
    projectId: string;
    id: string;
  }): Promise<WebhookEventRecord | undefined>;
  listWebhookEvents(input: {
    projectId: string;
    provider?: string;
    status?: WebhookEventRecord["status"];
    limit?: number;
  }): Promise<WebhookEventRecord[]>;
  findHandoffByExternalConversation(input: {
    projectId: string;
    provider: string;
    externalConversationId: string;
  }): Promise<HandoffSessionRecord | undefined>;
  createAuditLog(input: {
    projectId?: string;
    organizationId?: string;
    actorType: AuditLogRecord["actorType"];
    actorId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: JsonRecord;
    requestId?: string;
  }): Promise<AuditLogRecord>;
  listAuditLogs(input: {
    projectId: string;
    action?: string;
    limit?: number;
  }): Promise<AuditLogRecord[]>;
  upsertToolDefinition(input: {
    projectId: string;
    slug: string;
    name: string;
    description: string;
    kind: ToolDefinitionKind;
    status: ToolDefinitionStatus;
    method?: string;
    path?: string;
    inputSchema?: JsonRecord;
    outputSchema?: JsonRecord;
    metadata?: JsonRecord;
  }): Promise<ToolDefinitionRecord>;
  listToolDefinitions(input: {
    projectId: string;
    status?: ToolDefinitionStatus;
    limit?: number;
  }): Promise<ToolDefinitionRecord[]>;
  findToolDefinitionBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<ToolDefinitionRecord | undefined>;
  updateToolDefinitionStatus(input: {
    projectId: string;
    id: string;
    status: ToolDefinitionStatus;
  }): Promise<ToolDefinitionRecord>;
  createToolCall(input: {
    projectId: string;
    conversationId?: string;
    messageId?: string;
    toolId?: string;
    toolSlug: string;
    status: ToolCallStatus;
    input?: JsonRecord;
    output?: JsonRecord;
    error?: string;
    latencyMs?: number;
  }): Promise<ToolCallRecord>;
  listToolCalls(input: {
    projectId: string;
    conversationId?: string;
    limit?: number;
  }): Promise<ToolCallRecord[]>;
  getConversationInsight(input: {
    projectId: string;
    conversationId: string;
  }): Promise<ConversationInsightRecord | undefined>;
  upsertConversationInsight(input: {
    projectId: string;
    conversationId: string;
    summary: string;
    suggestedReplies: string[];
    tags: string[];
    metadata?: JsonRecord;
  }): Promise<ConversationInsightRecord>;
  createAsyncJob(input: {
    projectId: string;
    type: string;
    deduplicationKey?: string;
    payload?: JsonRecord;
    runAt?: string;
    maxAttempts?: number;
  }): Promise<AsyncJobRecord>;
  listAsyncJobs(input: {
    projectId: string;
    status?: AsyncJobStatus;
    type?: string;
    limit?: number;
  }): Promise<AsyncJobRecord[]>;
  claimNextAsyncJob(input: {
    workerId: string;
    types?: string[];
    now?: string;
    leaseMs?: number;
  }): Promise<AsyncJobRecord | undefined>;
  renewAsyncJobLease(input: {
    id: string;
    workerId: string;
    now?: string;
    leaseMs?: number;
  }): Promise<AsyncJobRecord>;
  completeAsyncJob(input: {
    id: string;
    workerId: string;
    result?: JsonRecord;
  }): Promise<AsyncJobRecord>;
  failAsyncJob(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt?: string;
  }): Promise<AsyncJobRecord>;
  createEvaluationSuite(input: {
    projectId: string;
    slug: string;
    version: number;
    name: string;
    status: EvaluationSuiteStatus;
    evaluatorVersion: string;
    thresholds: EvaluationThresholds;
    metadata?: JsonRecord;
    createdBy?: string;
    scenarios: Array<{
      slug: string;
      category: GoldenScenarioCategory;
      critical: boolean;
      input: JsonRecord;
      expectations: JsonRecord;
      metadata?: JsonRecord;
      orderIndex: number;
    }>;
  }): Promise<EvaluationSuiteRecord>;
  listEvaluationSuites(input: {
    projectId: string;
    status?: EvaluationSuiteStatus;
    limit?: number;
  }): Promise<EvaluationSuiteRecord[]>;
  findEvaluationSuite(input: {
    projectId: string;
    id: string;
  }): Promise<EvaluationSuiteRecord | undefined>;
  createEvaluationRun(input: {
    projectId: string;
    suite: EvaluationSuiteRecord;
    createdBy?: string;
    startedAt: string;
    completedAt: string;
    summary: {
      status: "passed" | "failed";
      evaluatorVersion: string;
      thresholds: EvaluationThresholds;
      score: number;
      passRate: number;
      passedCount: number;
      failedCount: number;
      criticalFailures: string[];
      results: EvaluationScenarioResult[];
    };
  }): Promise<EvaluationRunRecord>;
  listEvaluationRuns(input: {
    projectId: string;
    status?: "passed" | "failed";
    limit?: number;
  }): Promise<EvaluationRunSummaryRecord[]>;
  findEvaluationRun(input: {
    projectId: string;
    id: string;
  }): Promise<EvaluationRunRecord | undefined>;
  createEvolutionProposal(input: {
    projectId: string;
    sourceRunId: string;
    kind: EvolutionProposalKind;
    title: string;
    rationale: string;
    artifact: JsonRecord;
    artifactHash: string;
    baseline?: JsonRecord;
    createdBy?: string;
  }): Promise<EvolutionProposalRecord>;
  listEvolutionProposals(input: {
    projectId: string;
    status?: EvolutionProposalStatus;
    limit?: number;
  }): Promise<EvolutionProposalRecord[]>;
  findEvolutionProposal(input: {
    projectId: string;
    id: string;
  }): Promise<EvolutionProposalRecord | undefined>;
  transitionEvolutionProposal(input: {
    projectId: string;
    id: string;
    expectedStatus: EvolutionProposalStatus;
    status: EvolutionProposalStatus;
    regressionRunId?: string;
    canaryEvidence?: JsonRecord;
    rollbackTarget?: JsonRecord;
    reviewNote?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    promotedAt?: string;
    rolledBackAt?: string;
  }): Promise<EvolutionProposalRecord>;
};
