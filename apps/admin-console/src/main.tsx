import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowClockwise,
  ChatCircleText,
  Database,
  GearSix,
  MagnifyingGlass,
  PlugsConnected,
  Plus,
  Robot,
  UploadSimple
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
  createdAt: string;
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
        loadChatwootIntegration(activeProjectId)
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
          <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
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
                  <span>{document.title}</span>
                  <b>{document.status}</b>
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
              <input name="api_key" type="password" defaultValue="demo" />
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
              <input name="api_access_token" type="password" />
            </label>
            <label className="field">
              <span>Webhook secret</span>
              <input name="webhook_secret" type="password" />
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

function conversationLabel(conversation: Conversation): string {
  return (
    conversation.contact?.name ??
    conversation.contact?.email ??
    conversation.contact?.externalUserId ??
    conversation.id
  );
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
