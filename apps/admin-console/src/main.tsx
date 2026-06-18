import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowClockwise,
  ChatCircleText,
  Clock,
  Copy,
  Database,
  GearSix,
  Key,
  MagnifyingGlass,
  PlugsConnected,
  Plus,
  Pulse,
  Robot,
  ShieldCheck,
  Terminal,
  Trash,
  UploadSimple,
  WebhooksLogo
} from "@phosphor-icons/react";
import "./styles.css";

type Project = {
  id: string;
  name: string;
  publicKey: string;
  defaultLocale: string;
};

type Conversation = {
  id: string;
  status: string;
  assigneeType: "ai" | "human" | "none";
  contact?: {
    id: string;
    name?: string;
    email?: string;
    externalUserId?: string;
  };
  messageCount: number;
  lastMessage?: {
    id: string;
    role: string;
    text: string;
    createdAt: string;
  };
  handoff?: {
    id: string;
    provider: string;
    status: string;
    externalConversationId?: string;
    updatedAt: string;
  };
  channel?: {
    provider?: string;
    externalConversationId?: string;
    externalEventId?: string;
    externalUserId?: string;
    source?: string;
    receivedAt?: string;
  };
  lastMessageAt?: string;
  createdAt: string;
};

type ConversationSummary = {
  total: number;
  filtered: number;
  byStatus: Record<string, number>;
  byAssigneeType: Record<string, number>;
  handoffStatus: Record<string, number>;
};

type KnowledgeDocument = {
  id: string;
  title: string;
  status: string;
  sourceType: string;
  sourceUri?: string;
  metadata: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  role: string;
  content: { text?: string };
  createdAt: string;
};

type HandoffSession = {
  id: string;
  provider: string;
  externalContactId?: string;
  externalConversationId?: string;
  status: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type ChatwootIntegration = {
  id: string;
  status: string;
  metadata: Record<string, unknown>;
  configured: boolean;
  updatedAt?: string;
};

type GenericWebhookChannel = ChatwootIntegration & {
  provider: string;
};

type ChannelAdapter = {
  provider: string;
  name: string;
  status: string;
  capabilities: string[];
  configurationKeys: string[];
  notes?: string;
};

type ChannelAdapterTestResult = {
  provider: string;
  ok: boolean;
  status: string;
  message?: string;
};

type ApiKey = {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
};

type AuditLog = {
  id: string;
  actorType: string;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata: Record<string, unknown>;
  requestId?: string;
  createdAt: string;
};

type AsyncJob = {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type WebhookEvent = {
  id: string;
  provider: string;
  externalEventId?: string;
  payload: Record<string, unknown>;
  status: string;
  error?: string;
  createdAt: string;
  processedAt?: string;
};

type ToolCall = {
  id: string;
  conversationId?: string;
  toolSlug: string;
  status: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  latencyMs?: number;
  createdAt: string;
};

type OpsHealth = {
  status: string;
  generated_at: string;
  storage: { mode: string };
  checks: {
    repository: string;
    llm_provider_configured: boolean;
    chatwoot: { configured: boolean; status?: string };
  };
  counts: {
    conversations: Record<string, number>;
    recent_async_jobs: Record<string, number>;
    recent_webhook_events: Record<string, number>;
    tools: Record<string, number>;
    recent_tool_calls: Record<string, number>;
  };
  latest_audit_log?: AuditLog;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function App() {
  const [adminToken, setAdminToken] = useState(
    () => localStorage.getItem("osa_admin_token") ?? "admin_demo_key"
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("proj_demo");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationSummary, setConversationSummary] = useState<ConversationSummary>();
  const [conversationStatusFilter, setConversationStatusFilter] = useState("all");
  const [conversationQuery, setConversationQuery] = useState("");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [handoffSessions, setHandoffSessions] = useState<HandoffSession[]>([]);
  const [chatwootIntegration, setChatwootIntegration] = useState<ChatwootIntegration | undefined>();
  const [chatwootStatus, setChatwootStatus] = useState<string | undefined>();
  const [genericWebhookChannel, setGenericWebhookChannel] = useState<
    GenericWebhookChannel | undefined
  >();
  const [genericWebhookStatus, setGenericWebhookStatus] = useState<string | undefined>();
  const [slackChannel, setSlackChannel] = useState<GenericWebhookChannel | undefined>();
  const [slackStatus, setSlackStatus] = useState<string | undefined>();
  const [channelAdapters, setChannelAdapters] = useState<ChannelAdapter[]>([]);
  const [channelTestStatus, setChannelTestStatus] = useState<Record<string, string>>({});
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newApiKeySecret, setNewApiKeySecret] = useState<string | undefined>();
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [jobs, setJobs] = useState<AsyncJob[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [opsHealth, setOpsHealth] = useState<OpsHealth | undefined>();
  const [operationsError, setOperationsError] = useState<string | undefined>();
  const [status, setStatus] = useState("Loading");
  const [error, setError] = useState<string | undefined>();

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [activeProjectId, projects]
  );

  useEffect(() => {
    localStorage.setItem("osa_admin_token", adminToken);
  }, [adminToken]);

  useEffect(() => {
    void loadProjects();
  }, [adminToken]);

  useEffect(() => {
    if (activeProjectId) {
      void Promise.all([
        loadConversations(activeProjectId),
        loadDocuments(activeProjectId),
        loadChatwootIntegration(activeProjectId),
        loadOperations(activeProjectId)
      ]);
    }
  }, [activeProjectId, adminToken, conversationStatusFilter, conversationQuery]);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        ...init?.headers
      }
    });
    if (!response.ok) {
      throw new Error(await formatApiError(response));
    }
    return response.json() as Promise<T>;
  }

  async function formatApiError(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (payload.error?.message) {
        const code = payload.error.code ? `${payload.error.code}: ` : "";
        const requestId = payload.error.requestId ? ` (${payload.error.requestId})` : "";
        return `${code}${payload.error.message}${requestId}`;
      }
    } catch {
      // Fall back to the HTTP status when the response body is not JSON.
    }
    return `Request failed: ${response.status}`;
  }

  async function loadProjects() {
    try {
      setStatus("Loading projects");
      const payload = await request<{ projects: Project[] }>("/v1/admin/projects");
      setProjects(payload.projects);
      setActiveProjectId((current) => current || payload.projects[0]?.id || "proj_demo");
      setStatus("Ready");
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load projects");
      setStatus("Error");
    }
  }

  async function loadConversations(projectId: string) {
    const params = new URLSearchParams({ limit: "50" });
    if (conversationStatusFilter !== "all") {
      params.set("status", conversationStatusFilter);
    }
    const query = conversationQuery.trim();
    if (query) {
      params.set("q", query);
    }

    const payload = await request<{
      conversations: Conversation[];
      summary: ConversationSummary;
    }>(`/v1/admin/projects/${projectId}/conversations?${params.toString()}`);
    setConversations(payload.conversations);
    setConversationSummary(payload.summary);
  }

  async function loadDocuments(projectId: string) {
    const payload = await request<{ documents: KnowledgeDocument[] }>(
      `/v1/admin/projects/${projectId}/knowledge/documents`
    );
    setDocuments(payload.documents);
  }

  async function loadChatwootIntegration(projectId: string) {
    const payload = await request<{ integration: ChatwootIntegration | null }>(
      `/v1/admin/projects/${projectId}/integrations/chatwoot`
    );
    setChatwootIntegration(payload.integration ?? undefined);
  }

  async function loadOperations(projectId: string) {
    try {
      setOperationsError(undefined);
      const [
        healthPayload,
        adaptersPayload,
        genericPayload,
        slackPayload,
        apiKeysPayload,
        auditPayload,
        jobsPayload,
        webhookPayload,
        toolCallsPayload
      ] = await Promise.all([
        request<OpsHealth>(`/v1/admin/projects/${projectId}/ops/health`),
        request<{ adapters: ChannelAdapter[] }>(
          `/v1/admin/projects/${projectId}/channels/adapters`
        ),
        request<{ channel: GenericWebhookChannel | null }>(
          `/v1/admin/projects/${projectId}/channels/generic-webhook`
        ),
        request<{ channel: GenericWebhookChannel | null }>(
          `/v1/admin/projects/${projectId}/channels/slack`
        ),
        request<{ api_keys: ApiKey[] }>(
          `/v1/admin/projects/${projectId}/api-keys?include_revoked=true`
        ),
        request<{ audit_logs: AuditLog[] }>(`/v1/admin/projects/${projectId}/audit-log?limit=20`),
        request<{ jobs: AsyncJob[] }>(`/v1/admin/projects/${projectId}/jobs?limit=20`),
        request<{ webhook_events: WebhookEvent[] }>(
          `/v1/admin/projects/${projectId}/webhooks/events?limit=20`
        ),
        request<{ tool_calls: ToolCall[] }>(`/v1/admin/projects/${projectId}/tool-calls?limit=20`)
      ]);

      setOpsHealth(healthPayload);
      setChannelAdapters(adaptersPayload.adapters);
      setGenericWebhookChannel(genericPayload.channel ?? undefined);
      setSlackChannel(slackPayload.channel ?? undefined);
      setApiKeys(apiKeysPayload.api_keys);
      setAuditLogs(auditPayload.audit_logs);
      setJobs(jobsPayload.jobs);
      setWebhookEvents(webhookPayload.webhook_events);
      setToolCalls(toolCallsPayload.tool_calls);
    } catch (loadError) {
      setOperationsError(
        loadError instanceof Error ? loadError.message : "Unable to load operations data"
      );
    }
  }

  async function loadConversation(conversationId: string) {
    setSelectedConversation(conversationId);
    const payload = await request<{ messages: Message[]; handoff_sessions: HandoffSession[] }>(
      `/v1/admin/projects/${activeProjectId}/conversations/${conversationId}`
    );
    setMessages(payload.messages);
    setHandoffSessions(payload.handoff_sessions);
  }

  async function createProject(form: FormData) {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const payload = await request<{ project: Project }>("/v1/admin/projects", {
      method: "POST",
      body: JSON.stringify({ name, default_locale: "zh-CN" })
    });
    setProjects((current) => [...current, payload.project]);
    setActiveProjectId(payload.project.id);
  }

  async function createDocument(form: FormData) {
    await request(`/v1/admin/projects/${activeProjectId}/knowledge/documents`, {
      method: "POST",
      body: JSON.stringify({
        title: String(form.get("title") ?? ""),
        source_type: "markdown",
        content: String(form.get("content") ?? "")
      })
    });
    await loadDocuments(activeProjectId);
  }

  async function reindexDocument(documentId: string) {
    await request(
      `/v1/admin/projects/${activeProjectId}/knowledge/documents/${documentId}/reindex`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );
    await Promise.all([loadDocuments(activeProjectId), loadOperations(activeProjectId)]);
  }

  async function saveLlm(form: FormData) {
    await request(`/v1/admin/projects/${activeProjectId}/llm`, {
      method: "POST",
      body: JSON.stringify({
        base_url: String(form.get("base_url") ?? "demo://local"),
        model: String(form.get("model") ?? "demo-support-model"),
        embedding_model: String(form.get("embedding_model") ?? "demo-embedding"),
        api_key: String(form.get("api_key") ?? "demo"),
        status: "active"
      })
    });
  }

  async function saveChatwoot(form: FormData) {
    const payload = await request<{ integration: ChatwootIntegration }>(
      `/v1/admin/projects/${activeProjectId}/integrations/chatwoot`,
      {
        method: "POST",
        body: JSON.stringify({
          base_url: String(form.get("base_url") ?? "http://localhost:3008"),
          account_id: String(form.get("account_id") ?? "1"),
          inbox_id: String(form.get("inbox_id") ?? "1"),
          api_access_token: String(form.get("api_access_token") ?? ""),
          webhook_secret: String(form.get("webhook_secret") ?? ""),
          status: "active"
        })
      }
    );
    setChatwootIntegration(payload.integration);
    setChatwootStatus("Chatwoot settings saved");
  }

  async function testChatwoot() {
    setChatwootStatus("Testing Chatwoot");
    const payload = await request<{
      ok: boolean;
      error?: string;
      result?: { inboxName?: string };
      integration: ChatwootIntegration;
    }>(`/v1/admin/projects/${activeProjectId}/integrations/chatwoot/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setChatwootIntegration(payload.integration);
    setChatwootStatus(
      payload.ok
        ? `Connected${payload.result?.inboxName ? ` to ${payload.result.inboxName}` : ""}`
        : payload.error
    );
  }

  async function saveGenericWebhook(form: FormData) {
    const webhookSecret = String(form.get("webhook_secret") ?? "").trim();
    if (!webhookSecret) {
      setGenericWebhookStatus("Webhook secret is required");
      return;
    }

    try {
      setGenericWebhookStatus("Saving generic webhook");
      const payload = await request<{ channel: GenericWebhookChannel }>(
        `/v1/admin/projects/${activeProjectId}/channels/generic-webhook`,
        {
          method: "POST",
          body: JSON.stringify({
            webhook_secret: webhookSecret,
            secret_header:
              String(form.get("secret_header") ?? "").trim() || "x-opensupportai-webhook-secret",
            status: String(form.get("status") ?? "active")
          })
        }
      );
      setGenericWebhookChannel(payload.channel);
      setGenericWebhookStatus("Generic webhook saved");
      await loadOperations(activeProjectId);
    } catch (saveError) {
      setGenericWebhookStatus(
        saveError instanceof Error ? saveError.message : "Unable to save generic webhook"
      );
    }
  }

  async function saveSlackChannel(form: FormData) {
    const signingSecret = String(form.get("signing_secret") ?? "").trim();
    if (!signingSecret) {
      setSlackStatus("Signing secret is required");
      return;
    }

    try {
      setSlackStatus("Saving Slack channel");
      const payload = await request<{ channel: GenericWebhookChannel }>(
        `/v1/admin/projects/${activeProjectId}/channels/slack`,
        {
          method: "POST",
          body: JSON.stringify({
            signing_secret: signingSecret,
            default_channel_id: String(form.get("default_channel_id") ?? "").trim() || undefined,
            default_inbox_id: String(form.get("default_inbox_id") ?? "").trim() || "inbox_default",
            status: String(form.get("status") ?? "active")
          })
        }
      );
      setSlackChannel(payload.channel);
      setSlackStatus("Slack channel saved");
      await loadOperations(activeProjectId);
    } catch (saveError) {
      setSlackStatus(saveError instanceof Error ? saveError.message : "Unable to save Slack");
    }
  }

  async function testChannelAdapter(provider: string) {
    try {
      setChannelTestStatus((current) => ({ ...current, [provider]: "Testing" }));
      const payload = await request<{ result: ChannelAdapterTestResult }>(
        `/v1/admin/projects/${activeProjectId}/channels/adapters/${provider}/test`,
        {
          method: "POST",
          body: JSON.stringify({})
        }
      );
      setChannelTestStatus((current) => ({
        ...current,
        [provider]: `${payload.result.status}${payload.result.message ? `: ${payload.result.message}` : ""}`
      }));
      await loadOperations(activeProjectId);
    } catch (testError) {
      setChannelTestStatus((current) => ({
        ...current,
        [provider]: testError instanceof Error ? testError.message : "Adapter test failed"
      }));
    }
  }

  async function createApiKey(form: FormData) {
    try {
      setNewApiKeySecret(undefined);
      const payload = await request<{ api_key: ApiKey; key: string }>(
        `/v1/admin/projects/${activeProjectId}/api-keys`,
        {
          method: "POST",
          body: JSON.stringify({
            name: String(form.get("name") ?? "").trim(),
            scopes: parseScopes(String(form.get("scopes") ?? "admin:project"))
          })
        }
      );
      setNewApiKeySecret(payload.key);
      await loadOperations(activeProjectId);
    } catch (createError) {
      setOperationsError(
        createError instanceof Error ? createError.message : "Unable to create key"
      );
    }
  }

  async function revokeApiKey(keyId: string) {
    try {
      await request(`/v1/admin/projects/${activeProjectId}/api-keys/${keyId}`, {
        method: "DELETE"
      });
      await loadOperations(activeProjectId);
    } catch (revokeError) {
      setOperationsError(
        revokeError instanceof Error ? revokeError.message : "Unable to revoke key"
      );
    }
  }

  async function createJob(form: FormData) {
    try {
      await request(`/v1/admin/projects/${activeProjectId}/jobs`, {
        method: "POST",
        body: JSON.stringify({
          type: String(form.get("type") ?? "webhook.retry").trim(),
          payload: jsonRecordFromText(String(form.get("payload") ?? "{}")),
          max_attempts: Number(form.get("max_attempts") ?? 3)
        })
      });
      await loadOperations(activeProjectId);
    } catch (jobError) {
      setOperationsError(jobError instanceof Error ? jobError.message : "Unable to create job");
    }
  }

  async function retryWebhookEvent(eventId: string) {
    try {
      await request(`/v1/admin/projects/${activeProjectId}/webhooks/events/${eventId}/retry`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await loadOperations(activeProjectId);
    } catch (retryError) {
      setOperationsError(
        retryError instanceof Error ? retryError.message : "Unable to schedule webhook retry"
      );
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function retryHandoff(handoffId: string) {
    await request(`/v1/admin/projects/${activeProjectId}/handoffs/${handoffId}/retry`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (selectedConversation) {
      await loadConversation(selectedConversation);
    }
    await loadConversations(activeProjectId);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/opensupportai-mark.png" alt="" />
          <div>
            <strong>OpenSupportAI</strong>
            <span>{status}</span>
          </div>
        </div>
        <label className="field">
          <span>Admin token</span>
          <input
            autoComplete="current-password"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
          />
        </label>
        <nav>
          <a href="#conversations">
            <ChatCircleText size={18} /> Conversations
          </a>
          <a href="#knowledge">
            <Database size={18} /> Knowledge
          </a>
          <a href="#settings">
            <GearSix size={18} /> Settings
          </a>
          <a href="#operations">
            <Pulse size={18} /> Operations
          </a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Project</p>
            <h1>{activeProject?.name ?? "No project"}</h1>
            {activeProject?.publicKey ? (
              <p className="project-key">{activeProject.publicKey}</p>
            ) : null}
          </div>
          <select
            value={activeProjectId}
            onChange={(event) => setActiveProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </header>

        {error ? <div className="notice">{error}</div> : null}

        <section className="grid overview">
          <Metric
            icon={<ChatCircleText />}
            label="Conversations"
            value={String(conversationSummary?.total ?? conversations.length)}
          />
          <Metric
            icon={<ChatCircleText />}
            label="Open"
            value={String(conversationSummary?.byStatus.open ?? 0)}
          />
          <Metric
            icon={<PlugsConnected />}
            label="Human queue"
            value={String(conversationSummary?.byAssigneeType.human ?? 0)}
          />
          <Metric icon={<Database />} label="Documents" value={String(documents.length)} />
        </section>

        <section className="split" id="conversations">
          <div className="panel">
            <div className="panel-title">
              <ChatCircleText size={20} />
              <h2>Conversations</h2>
              <button
                className="icon-button"
                title="Refresh conversations"
                onClick={() => void loadConversations(activeProjectId)}
              >
                <ArrowClockwise size={16} />
              </button>
            </div>
            <div className="conversation-tools">
              <select
                value={conversationStatusFilter}
                onChange={(event) => setConversationStatusFilter(event.target.value)}
              >
                <option value="all">All status</option>
                <option value="open">Open</option>
                <option value="pending_ai">Pending AI</option>
                <option value="handoff_requested">Handoff requested</option>
                <option value="handed_off">Handed off</option>
                <option value="closed">Closed</option>
              </select>
              <label>
                <MagnifyingGlass size={16} />
                <input
                  value={conversationQuery}
                  onChange={(event) => setConversationQuery(event.target.value)}
                  placeholder="Search conversations"
                />
              </label>
            </div>
            <div className="list-summary">
              <span>{conversationSummary?.filtered ?? conversations.length} shown</span>
              <span>{conversationSummary?.handoffStatus.failed ?? 0} failed handoffs</span>
            </div>
            <div className="list">
              {conversations.length === 0 ? <Empty text="No conversations yet" /> : null}
              {conversations.map((conversation) => (
                <button
                  className={`row conversation-row ${
                    selectedConversation === conversation.id ? "selected" : ""
                  }`}
                  key={conversation.id}
                  onClick={() => void loadConversation(conversation.id)}
                >
                  <span className="row-main">
                    <strong>{conversationLabel(conversation)}</strong>
                    <small>{conversation.lastMessage?.text || conversation.id}</small>
                  </span>
                  <span className="row-meta">
                    <b>{conversation.status}</b>
                    <small>{conversation.messageCount} messages</small>
                    {conversation.handoff ? (
                      <small>
                        {conversation.handoff.provider} {conversation.handoff.status}
                      </small>
                    ) : null}
                    {conversation.channel?.provider ? (
                      <small>{conversation.channel.provider}</small>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-title">
              <Robot size={20} />
              <h2>Messages</h2>
            </div>
            <div className="messages">
              {!selectedConversation ? <Empty text="Select a conversation" /> : null}
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <strong>{message.role}</strong>
                  <p>{message.content.text}</p>
                </article>
              ))}
            </div>
            {selectedConversation ? (
              <div className="handoffs">
                <h3>Handoff</h3>
                {handoffSessions.length === 0 ? <Empty text="No handoff sessions" /> : null}
                {handoffSessions.map((session) => (
                  <div className="handoff-row" key={session.id}>
                    <div>
                      <strong>{session.provider}</strong>
                      <span>{session.status}</span>
                      {session.externalConversationId ? (
                        <small>External conversation {session.externalConversationId}</small>
                      ) : null}
                      {typeof session.metadata.error === "string" ? (
                        <small>{session.metadata.error}</small>
                      ) : null}
                    </div>
                    {session.provider === "chatwoot" &&
                    (session.status === "failed" || session.status === "requested") ? (
                      <button className="secondary" onClick={() => void retryHandoff(session.id)}>
                        <ArrowClockwise size={16} /> Retry
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="split" id="knowledge">
          <form className="panel form" action={(form) => void createDocument(form)}>
            <div className="panel-title">
              <UploadSimple size={20} />
              <h2>Knowledge</h2>
            </div>
            <label className="field">
              <span>Title</span>
              <input name="title" placeholder="Billing FAQ" />
            </label>
            <label className="field">
              <span>Markdown/Text</span>
              <textarea name="content" rows={8} placeholder="Paste support policy content" />
            </label>
            <button className="primary">
              <Plus size={16} /> Add document
            </button>
          </form>
          <div className="panel">
            <div className="panel-title">
              <Database size={20} />
              <h2>Indexed documents</h2>
            </div>
            <div className="list">
              {documents.map((document) => (
                <div className="row static" key={document.id}>
                  <span className="row-main">
                    <strong>{document.title}</strong>
                    <small>
                      {document.sourceUri ?? document.sourceType} · {formatDate(document.updatedAt)}
                    </small>
                    {document.error ? <small>{document.error}</small> : null}
                  </span>
                  <span className="row-meta">
                    <b>{document.status}</b>
                    <small>{knowledgeChunkCount(document.metadata)} chunks</small>
                  </span>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void reindexDocument(document.id)}
                  >
                    <ArrowClockwise size={16} /> Reindex
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="split" id="settings">
          <form className="panel form" action={(form) => void saveLlm(form)}>
            <div className="panel-title">
              <Robot size={20} />
              <h2>LLM provider</h2>
            </div>
            <label className="field">
              <span>Base URL</span>
              <input name="base_url" defaultValue="demo://local" />
            </label>
            <label className="field">
              <span>Model</span>
              <input name="model" defaultValue="demo-support-model" />
            </label>
            <label className="field">
              <span>Embedding model</span>
              <input name="embedding_model" defaultValue="demo-embedding" />
            </label>
            <label className="field">
              <span>API key</span>
              <input
                name="api_key"
                type="password"
                autoComplete="current-password"
                defaultValue="demo"
              />
            </label>
            <button className="primary">Save LLM</button>
          </form>

          <form className="panel form" action={(form) => void saveChatwoot(form)}>
            <div className="panel-title">
              <PlugsConnected size={20} />
              <h2>Chatwoot</h2>
            </div>
            <label className="field">
              <span>Base URL</span>
              <input name="base_url" defaultValue="http://localhost:3008" />
            </label>
            <div className="two">
              <label className="field">
                <span>Account</span>
                <input name="account_id" defaultValue="1" />
              </label>
              <label className="field">
                <span>Inbox</span>
                <input name="inbox_id" defaultValue="1" />
              </label>
            </div>
            <label className="field">
              <span>API token</span>
              <input name="api_access_token" type="password" autoComplete="current-password" />
            </label>
            <label className="field">
              <span>Webhook secret</span>
              <input name="webhook_secret" type="password" autoComplete="new-password" />
            </label>
            <div className="actions">
              <button className="primary">Save Chatwoot</button>
              <button className="secondary" type="button" onClick={() => void testChatwoot()}>
                <PlugsConnected size={16} /> Test
              </button>
            </div>
            <IntegrationStatus integration={chatwootIntegration} status={chatwootStatus} />
          </form>
        </section>

        <section className="operations" id="operations">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Operations</p>
              <h2>Runtime controls</h2>
            </div>
            <button className="secondary" onClick={() => void loadOperations(activeProjectId)}>
              <ArrowClockwise size={16} /> Refresh
            </button>
          </div>
          {operationsError ? <div className="notice">{operationsError}</div> : null}

          <section className="split">
            <div className="panel">
              <div className="panel-title">
                <Pulse size={20} />
                <h2>Ops health</h2>
              </div>
              {opsHealth ? (
                <div className="status-grid">
                  <StatusItem label="Storage" value={opsHealth.storage.mode} />
                  <StatusItem label="Repository" value={opsHealth.checks.repository} />
                  <StatusItem
                    label="LLM configured"
                    value={opsHealth.checks.llm_provider_configured ? "yes" : "no"}
                  />
                  <StatusItem
                    label="Chatwoot"
                    value={
                      opsHealth.checks.chatwoot.configured
                        ? (opsHealth.checks.chatwoot.status ?? "configured")
                        : "not configured"
                    }
                  />
                  <StatusItem
                    label="Async jobs"
                    value={countSummary(opsHealth.counts.recent_async_jobs)}
                  />
                  <StatusItem
                    label="Webhook events"
                    value={countSummary(opsHealth.counts.recent_webhook_events)}
                  />
                </div>
              ) : (
                <Empty text="Operations health has not loaded" />
              )}
            </div>

            <div className="panel">
              <div className="panel-title">
                <WebhooksLogo size={20} />
                <h2>Channel adapters</h2>
              </div>
              <div className="list">
                {channelAdapters.map((adapter) => (
                  <div className="row adapter-row" key={adapter.provider}>
                    <span className="row-main">
                      <strong>{adapter.name}</strong>
                      <small>{adapter.notes ?? adapter.provider}</small>
                      {channelTestStatus[adapter.provider] ? (
                        <small>{channelTestStatus[adapter.provider]}</small>
                      ) : null}
                    </span>
                    <span className="row-meta">
                      <b>{adapter.status}</b>
                      <button
                        className="secondary compact"
                        onClick={() => void testChannelAdapter(adapter.provider)}
                      >
                        Test
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="split">
            <form className="panel form" action={(form) => void saveGenericWebhook(form)}>
              <div className="panel-title">
                <WebhooksLogo size={20} />
                <h2>Generic webhook</h2>
              </div>
              <div className="status-grid slim">
                <StatusItem
                  label="Status"
                  value={genericWebhookChannel?.status ?? "not configured"}
                />
                <StatusItem
                  label="Secret header"
                  value={metadataString(genericWebhookChannel?.metadata, "secret_header") ?? "-"}
                />
              </div>
              <label className="field">
                <span>Webhook secret</span>
                <input
                  name="webhook_secret"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="field">
                <span>Secret header</span>
                <input
                  name="secret_header"
                  defaultValue={
                    metadataString(genericWebhookChannel?.metadata, "secret_header") ??
                    "x-opensupportai-webhook-secret"
                  }
                />
              </label>
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={genericWebhookChannel?.status ?? "active"}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <button className="primary">Save webhook channel</button>
              {genericWebhookStatus ? (
                <div className="integration-status">{genericWebhookStatus}</div>
              ) : null}
            </form>

            <form className="panel form" action={(form) => void saveSlackChannel(form)}>
              <div className="panel-title">
                <PlugsConnected size={20} />
                <h2>Slack inbound</h2>
              </div>
              <div className="status-grid slim">
                <StatusItem label="Status" value={slackChannel?.status ?? "not configured"} />
                <StatusItem
                  label="Default channel"
                  value={metadataString(slackChannel?.metadata, "default_channel_id") ?? "-"}
                />
                <StatusItem
                  label="Default inbox"
                  value={
                    metadataString(slackChannel?.metadata, "default_inbox_id") ?? "inbox_default"
                  }
                />
              </div>
              <label className="field">
                <span>Signing secret</span>
                <input
                  name="signing_secret"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Slack app signing secret"
                />
              </label>
              <div className="two">
                <label className="field">
                  <span>Default channel</span>
                  <input
                    name="default_channel_id"
                    defaultValue={
                      metadataString(slackChannel?.metadata, "default_channel_id") ?? ""
                    }
                    placeholder="C123"
                  />
                </label>
                <label className="field">
                  <span>Default inbox</span>
                  <input
                    name="default_inbox_id"
                    defaultValue={
                      metadataString(slackChannel?.metadata, "default_inbox_id") ?? "inbox_default"
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={slackChannel?.status ?? "active"}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <button className="primary">Save Slack channel</button>
              {slackStatus ? <div className="integration-status">{slackStatus}</div> : null}
            </form>

            <form className="panel form" action={(form) => void createApiKey(form)}>
              <div className="panel-title">
                <Key size={20} />
                <h2>Admin API keys</h2>
              </div>
              <label className="field">
                <span>Name</span>
                <input name="name" placeholder="Production automation" />
              </label>
              <label className="field">
                <span>Scopes</span>
                <input name="scopes" defaultValue="admin:project,admin:webhooks" />
              </label>
              <button className="primary">
                <Key size={16} /> Create key
              </button>
              {newApiKeySecret ? (
                <div className="secret-box">
                  <code>{newApiKeySecret}</code>
                  <button
                    className="icon-button"
                    type="button"
                    title="Copy API key"
                    onClick={() => void copyText(newApiKeySecret)}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              ) : null}
              <div className="list">
                {apiKeys.map((apiKey) => (
                  <div className="row" key={apiKey.id}>
                    <span className="row-main">
                      <strong>{apiKey.name}</strong>
                      <small>{apiKey.scopes.join(", ")}</small>
                      {apiKey.lastUsedAt ? (
                        <small>Used {formatDate(apiKey.lastUsedAt)}</small>
                      ) : null}
                    </span>
                    <span className="row-meta">
                      <b>{apiKey.revokedAt ? "revoked" : "active"}</b>
                      {!apiKey.revokedAt ? (
                        <button
                          className="secondary compact danger"
                          type="button"
                          onClick={() => void revokeApiKey(apiKey.id)}
                        >
                          <Trash size={14} /> Revoke
                        </button>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </form>
          </section>

          <section className="split">
            <div className="panel">
              <div className="panel-title">
                <Clock size={20} />
                <h2>Jobs</h2>
              </div>
              <form className="inline-form" action={(form) => void createJob(form)}>
                <input name="type" defaultValue="webhook.retry" />
                <input name="max_attempts" type="number" min="1" max="10" defaultValue="3" />
                <textarea name="payload" rows={3} defaultValue="{}" />
                <button className="secondary">Queue job</button>
              </form>
              <div className="list scroll-list">
                {jobs.length === 0 ? <Empty text="No jobs yet" /> : null}
                {jobs.map((job) => (
                  <div className="row static" key={job.id}>
                    <span className="row-main">
                      <strong>{job.type}</strong>
                      <small>{job.error ?? formatDate(job.runAt)}</small>
                    </span>
                    <span className="row-meta">
                      <b>{job.status}</b>
                      <small>
                        {job.attempts}/{job.maxAttempts}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">
                <WebhooksLogo size={20} />
                <h2>Webhook events</h2>
              </div>
              <div className="list scroll-list">
                {webhookEvents.length === 0 ? <Empty text="No webhook events yet" /> : null}
                {webhookEvents.map((event) => (
                  <div className="row" key={event.id}>
                    <span className="row-main">
                      <strong>{event.provider}</strong>
                      <small>{event.externalEventId ?? event.id}</small>
                      {event.error ? <small>{event.error}</small> : null}
                    </span>
                    <span className="row-meta">
                      <b>{event.status}</b>
                      {event.status !== "processed" ? (
                        <button
                          className="secondary compact"
                          onClick={() => void retryWebhookEvent(event.id)}
                        >
                          Retry
                        </button>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="split">
            <div className="panel">
              <div className="panel-title">
                <ShieldCheck size={20} />
                <h2>Audit log</h2>
              </div>
              <div className="list scroll-list">
                {auditLogs.length === 0 ? <Empty text="No audit logs yet" /> : null}
                {auditLogs.map((log) => (
                  <div className="row static" key={log.id}>
                    <span className="row-main">
                      <strong>{log.action}</strong>
                      <small>
                        {log.targetType ? `${log.targetType} ${log.targetId ?? ""}` : log.id}
                      </small>
                    </span>
                    <span className="row-meta">
                      <b>{log.actorType}</b>
                      <small>{formatDate(log.createdAt)}</small>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-title">
                <Terminal size={20} />
                <h2>Tool calls</h2>
              </div>
              <div className="list scroll-list">
                {toolCalls.length === 0 ? <Empty text="No tool calls yet" /> : null}
                {toolCalls.map((toolCall) => (
                  <div className="row static" key={toolCall.id}>
                    <span className="row-main">
                      <strong>{toolCall.toolSlug}</strong>
                      <small>{toolCall.conversationId ?? toolCall.id}</small>
                      {toolCall.error ? <small>{toolCall.error}</small> : null}
                    </span>
                    <span className="row-meta">
                      <b>{toolCall.status}</b>
                      {typeof toolCall.latencyMs === "number" ? (
                        <small>{toolCall.latencyMs}ms</small>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>

        <form className="create-project" action={(form) => void createProject(form)}>
          <input name="name" placeholder="New project name" />
          <button>
            <Plus size={16} /> Create project
          </button>
        </form>
      </section>
    </main>
  );
}

function Metric(props: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      <div>{props.icon}</div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function Empty(props: { text: string }) {
  return <div className="empty">{props.text}</div>;
}

function StatusItem(props: { label: string; value: string }) {
  return (
    <div className="status-item">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function conversationLabel(conversation: Conversation): string {
  return (
    conversation.contact?.name ??
    conversation.contact?.email ??
    conversation.contact?.externalUserId ??
    conversation.id
  );
}

function parseScopes(value: string): string[] {
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : ["admin:project"];
}

function jsonRecordFromText(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function countSummary(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return "0";
  }
  return entries.map(([key, value]) => `${key} ${value}`).join(", ");
}

function knowledgeChunkCount(metadata: Record<string, unknown>): number {
  const value = metadata["chunk_count"];
  return typeof value === "number" ? value : 0;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function IntegrationStatus(props: {
  integration?: ChatwootIntegration;
  status?: string;
}): React.ReactElement {
  const metadata = props.integration?.metadata ?? {};
  const lastTestOk = metadata["last_test_ok"];
  const lastTestedAt = metadata["last_tested_at"];
  const lastTestError = metadata["last_test_error"];
  const lastTestInboxName = metadata["last_test_inbox_name"];

  return (
    <div className="integration-status">
      <span>{props.integration ? `Status: ${props.integration.status}` : "Not configured"}</span>
      {props.status ? <b>{props.status}</b> : null}
      {typeof lastTestOk === "boolean" ? (
        <span>Last test: {lastTestOk ? "ok" : "failed"}</span>
      ) : null}
      {typeof lastTestInboxName === "string" ? <span>Inbox: {lastTestInboxName}</span> : null}
      {typeof lastTestError === "string" ? <span>{lastTestError}</span> : null}
      {typeof lastTestedAt === "string" ? <small>{lastTestedAt}</small> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
