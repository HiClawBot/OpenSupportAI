import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChatCircleText,
  Database,
  GearSix,
  Key,
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
  lastMessageAt?: string;
  createdAt: string;
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

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function App() {
  const [adminToken, setAdminToken] = useState(
    () => localStorage.getItem("osa_admin_token") ?? "admin_demo_key"
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("proj_demo");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
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
      void Promise.all([loadConversations(activeProjectId), loadDocuments(activeProjectId)]);
    }
  }, [activeProjectId, adminToken]);

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
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
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
    const payload = await request<{ conversations: Conversation[] }>(
      `/v1/admin/projects/${projectId}/conversations`
    );
    setConversations(payload.conversations);
  }

  async function loadDocuments(projectId: string) {
    const payload = await request<{ documents: KnowledgeDocument[] }>(
      `/v1/admin/projects/${projectId}/knowledge/documents`
    );
    setDocuments(payload.documents);
  }

  async function loadConversation(conversationId: string) {
    setSelectedConversation(conversationId);
    const payload = await request<{ messages: Message[] }>(
      `/v1/admin/projects/${activeProjectId}/conversations/${conversationId}`
    );
    setMessages(payload.messages);
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
    await request(`/v1/admin/projects/${activeProjectId}/integrations/chatwoot`, {
      method: "POST",
      body: JSON.stringify({
        base_url: String(form.get("base_url") ?? "http://localhost:3008"),
        account_id: String(form.get("account_id") ?? "1"),
        inbox_id: String(form.get("inbox_id") ?? "1"),
        api_access_token: String(form.get("api_access_token") ?? ""),
        webhook_secret: String(form.get("webhook_secret") ?? ""),
        status: "active"
      })
    });
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
            value={String(conversations.length)}
          />
          <Metric icon={<Database />} label="Documents" value={String(documents.length)} />
          <Metric icon={<Key />} label="Public key" value={activeProject?.publicKey ?? "n/a"} />
        </section>

        <section className="split" id="conversations">
          <div className="panel">
            <div className="panel-title">
              <ChatCircleText size={20} />
              <h2>Conversations</h2>
            </div>
            <div className="list">
              {conversations.length === 0 ? <Empty text="No conversations yet" /> : null}
              {conversations.map((conversation) => (
                <button
                  className="row"
                  key={conversation.id}
                  onClick={() => void loadConversation(conversation.id)}
                >
                  <span>{conversation.id}</span>
                  <b>{conversation.status}</b>
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
            <button className="primary">Save Chatwoot</button>
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
