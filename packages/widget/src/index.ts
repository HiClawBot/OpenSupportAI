import type { ClientEvent, Message } from "@opensupportai/protocol";

export type OpenSupportAIWidgetOptions = {
  apiUrl?: string;
  projectId: string;
  publicKey?: string;
  userToken?: string;
  inboxId?: string;
  locale?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
};

export type OpenSupportAIWidgetController = {
  client: OpenSupportAIWidgetClient;
  destroy: () => void;
};

export function init(options: OpenSupportAIWidgetOptions): OpenSupportAIWidgetController {
  const client = new OpenSupportAIWidgetClient({
    apiUrl: options.apiUrl ?? "http://localhost:4000",
    projectId: options.projectId,
    publicKey: options.publicKey,
    userToken: options.userToken
  });

  if (typeof document === "undefined") {
    return {
      client,
      destroy: () => undefined
    };
  }

  const mount = document.createElement("div");
  mount.id = "opensupportai-widget-root";
  document.body.appendChild(mount);
  const widget = new WidgetView(client, options, mount);
  widget.render();

  return {
    client,
    destroy: () => widget.destroy()
  };
}

export const OpenSupportAI = {
  init
};

class WidgetView {
  private conversationId: string | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly shadowRoot: ShadowRoot;
  private messages: Message[] = [];
  private open = false;
  private sending = false;
  private error: string | undefined;

  constructor(
    private readonly client: OpenSupportAIWidgetClient,
    private readonly options: OpenSupportAIWidgetOptions,
    private readonly mount: HTMLElement
  ) {
    this.shadowRoot = mount.attachShadow({ mode: "open" });
    this.conversationId = localStorage.getItem(this.storageKey()) ?? undefined;
  }

  render(): void {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <button class="osa-bubble" aria-label="Open support chat">${this.open ? "×" : "?"}</button>
      <section class="osa-panel ${this.open ? "is-open" : ""}" aria-live="polite">
        <header class="osa-header">
          <div>
            <strong>OpenSupportAI</strong>
            <span>Support</span>
          </div>
          <button class="osa-icon" aria-label="Close">×</button>
        </header>
        <div class="osa-messages">
          ${this.messages.length === 0 ? `<div class="osa-empty">有什么可以帮你？</div>` : ""}
          ${this.messages.map((message) => this.renderMessage(message)).join("")}
          ${this.error ? `<div class="osa-error">${escapeHtml(this.error)}</div>` : ""}
        </div>
        <form class="osa-composer">
          <button type="button" class="osa-handoff">人工</button>
          <input name="text" autocomplete="off" placeholder="输入问题" ${this.sending ? "disabled" : ""} />
          <button type="submit" class="osa-send" ${this.sending ? "disabled" : ""}>发送</button>
        </form>
      </section>
    `;

    this.shadowRoot.querySelector(".osa-bubble")?.addEventListener("click", () => {
      this.open = !this.open;
      this.render();
      if (this.open) {
        void this.ensureConversation();
      }
    });
    this.shadowRoot.querySelector(".osa-icon")?.addEventListener("click", () => {
      this.open = false;
      this.render();
    });
    this.shadowRoot.querySelector(".osa-handoff")?.addEventListener("click", () => {
      void this.requestHandoff();
    });
    this.shadowRoot.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = this.shadowRoot.querySelector<HTMLInputElement>('input[name="text"]');
      const text = input?.value.trim();
      if (!text) {
        return;
      }
      if (input) {
        input.value = "";
      }
      void this.send(text);
    });
  }

  destroy(): void {
    this.unsubscribe?.();
    this.mount.remove();
  }

  private async ensureConversation(): Promise<string> {
    if (this.conversationId) {
      await this.refreshMessages();
      return this.conversationId;
    }

    const conversation = await this.client.createConversation({
      inboxId: this.options.inboxId ?? "inbox_default",
      contact: {
        externalUserId: this.options.user?.id,
        name: this.options.user?.name,
        email: this.options.user?.email
      },
      metadata: {
        page_url: window.location.href,
        locale: this.options.locale ?? navigator.language
      }
    });
    this.conversationId = conversation.conversationId;
    localStorage.setItem(this.storageKey(), conversation.conversationId);
    this.unsubscribe = this.client.subscribe(conversation.conversationId, (event) =>
      this.handleEvent(event)
    );
    return conversation.conversationId;
  }

  private async refreshMessages(): Promise<void> {
    if (!this.conversationId) {
      return;
    }
    const response = await this.client.listMessages(this.conversationId);
    this.messages = response.messages;
    if (!this.unsubscribe) {
      this.unsubscribe = this.client.subscribe(this.conversationId, (event) =>
        this.handleEvent(event)
      );
    }
    this.render();
  }

  private async send(text: string): Promise<void> {
    this.sending = true;
    this.error = undefined;
    this.render();
    try {
      const conversationId = await this.ensureConversation();
      await this.client.sendMessage({ conversationId, text });
      await this.refreshMessages();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "发送失败";
    } finally {
      this.sending = false;
      this.render();
    }
  }

  private async requestHandoff(): Promise<void> {
    try {
      const conversationId = await this.ensureConversation();
      await this.client.requestHandoff({
        conversationId,
        reason: "user_requested",
        note: "Requested from widget"
      });
      this.messages = [
        ...this.messages,
        syntheticMessage(conversationId, "system", "已请求人工客服。")
      ];
      this.render();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "请求人工失败";
      this.render();
    }
  }

  private handleEvent(event: ClientEvent): void {
    if (event.event === "message.created" || event.event === "ai.message.completed") {
      this.messages = upsertMessage(this.messages, event.data.message);
      this.render();
    }
    if (event.event === "human.message.created") {
      this.messages = upsertMessage(this.messages, event.data.message);
      this.render();
    }
    if (event.event === "ai.delta") {
      const conversationId = event.data.conversationId;
      const last = this.messages.at(-1);
      if (last?.role === "ai_agent" && last.id.startsWith("stream_")) {
        last.content = {
          text: `${textFromMessage(last)}${event.data.text}`
        };
        this.messages = [...this.messages.slice(0, -1), last];
      } else {
        this.messages = [
          ...this.messages,
          syntheticMessage(conversationId, "ai_agent", event.data.text, "stream")
        ];
      }
      this.render();
    }
    if (event.event === "handoff.requested") {
      this.messages = [
        ...this.messages,
        syntheticMessage(event.data.conversationId, "system", "已请求人工客服。")
      ];
      this.render();
    }
    if (event.event === "error") {
      this.error = event.data.message;
      this.render();
    }
  }

  private renderMessage(message: Message): string {
    const roleClass =
      message.role === "end_user"
        ? "is-user"
        : message.role === "system"
          ? "is-system"
          : "is-agent";
    return `<div class="osa-message ${roleClass}">
      <div class="osa-message-text">${escapeHtml(textFromMessage(message))}</div>
      ${
        message.sourceRefs?.length
          ? `<div class="osa-sources">${message.sourceRefs
              .map((source) => escapeHtml(source.title ?? source.documentId))
              .join(" · ")}</div>`
          : ""
      }
    </div>`;
  }

  private storageKey(): string {
    return `opensupportai:${this.options.projectId}:conversation`;
  }
}

export class OpenSupportAIWidgetClient {
  readonly options: Required<Pick<OpenSupportAIWidgetOptions, "apiUrl" | "projectId">> &
    Pick<OpenSupportAIWidgetOptions, "publicKey" | "userToken">;

  constructor(options: {
    apiUrl: string;
    projectId: string;
    publicKey?: string;
    userToken?: string;
  }) {
    this.options = options;
  }

  async createConversation(input: {
    inboxId?: string;
    contact?: {
      externalUserId?: string;
      name?: string;
      email?: string;
      avatarUrl?: string;
    };
    metadata?: Record<string, unknown>;
  }): Promise<{ conversationId: string; status: string }> {
    const response = await this.request<{ conversation_id: string; status: string }>(
      "/v1/client/conversations",
      {
        method: "POST",
        body: JSON.stringify({
          project_id: this.options.projectId,
          inbox_id: input.inboxId,
          contact: {
            external_user_id: input.contact?.externalUserId,
            name: input.contact?.name,
            email: input.contact?.email,
            avatar_url: input.contact?.avatarUrl
          },
          metadata: input.metadata ?? {}
        })
      }
    );
    return {
      conversationId: response.conversation_id,
      status: response.status
    };
  }

  async sendMessage(input: {
    conversationId: string;
    text: string;
  }): Promise<{ messageId: string; conversationId: string; status: string }> {
    const response = await this.request<{
      message_id: string;
      conversation_id: string;
      status: string;
    }>(`/v1/client/conversations/${input.conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "text",
        text: input.text
      })
    });
    return {
      messageId: response.message_id,
      conversationId: response.conversation_id,
      status: response.status
    };
  }

  listMessages(conversationId: string): Promise<{ messages: Message[] }> {
    return this.request(`/v1/client/conversations/${conversationId}/messages`, {
      method: "GET"
    });
  }

  async requestHandoff(input: {
    conversationId: string;
    reason: string;
    note?: string;
  }): Promise<{ conversationId: string; status: string }> {
    const response = await this.request<{ conversation_id: string; status: string }>(
      `/v1/client/conversations/${input.conversationId}/handoff`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: input.reason,
          note: input.note
        })
      }
    );
    return {
      conversationId: response.conversation_id,
      status: response.status
    };
  }

  subscribe(conversationId: string, handler: (event: ClientEvent) => void): () => void {
    const url = new URL(`${this.options.apiUrl}/v1/client/conversations/${conversationId}/events`);
    if (this.options.publicKey) {
      url.searchParams.set("public_key", this.options.publicKey);
    }
    const eventSource = new EventSource(url.toString());
    const eventNames = [
      "message.created",
      "ai.delta",
      "ai.message.completed",
      "handoff.requested",
      "human.message.created",
      "conversation.status_changed",
      "error"
    ] as const;

    for (const eventName of eventNames) {
      eventSource.addEventListener(eventName, (event) => {
        handler({
          event: eventName,
          data: JSON.parse(event.data)
        } as ClientEvent);
      });
    }

    return () => eventSource.close();
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.options.apiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders()
      }
    });
    if (!response.ok) {
      throw new Error(`OpenSupportAI request failed with status ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private authHeaders(): Record<string, string> {
    if (this.options.userToken) {
      return {
        Authorization: `Bearer ${this.options.userToken}`
      };
    }
    if (this.options.publicKey) {
      return {
        "X-OpenSupportAI-Public-Key": this.options.publicKey
      };
    }
    return {};
  }
}

function upsertMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return [...messages, message];
  }
  return [...messages.slice(0, index), message, ...messages.slice(index + 1)];
}

function syntheticMessage(
  conversationId: string,
  role: Message["role"],
  text: string,
  prefix = "local"
): Message {
  return {
    id: `${prefix}_${Date.now()}`,
    conversationId,
    role,
    visibility: "public",
    contentType: "text",
    content: { text },
    createdAt: new Date().toISOString()
  };
}

function textFromMessage(message: Message): string {
  const text = message.content["text"];
  return typeof text === "string" ? text : "";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const styles = `
:host { all: initial; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.osa-bubble {
  position: fixed; right: 24px; bottom: 24px; width: 56px; height: 56px; border: 0;
  border-radius: 50%; background: #101828; color: #fff; font: 700 24px/1 system-ui;
  box-shadow: 0 16px 40px rgba(16, 24, 40, .22); cursor: pointer; z-index: 2147483647;
}
.osa-panel {
  position: fixed; right: 24px; bottom: 92px; width: min(380px, calc(100vw - 32px)); height: 560px;
  max-height: calc(100vh - 120px); border: 1px solid #d6dbe6; border-radius: 8px; background: #fff;
  box-shadow: 0 18px 52px rgba(16, 24, 40, .18); display: none; overflow: hidden; z-index: 2147483647;
}
.osa-panel.is-open { display: grid; grid-template-rows: auto 1fr auto; }
.osa-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #e6e9f0; background: #f8fafc; color: #111827; }
.osa-header strong { display: block; font-size: 14px; letter-spacing: 0; }
.osa-header span { display: block; font-size: 12px; color: #667085; margin-top: 2px; }
.osa-icon { width: 32px; height: 32px; border: 1px solid #d6dbe6; border-radius: 6px; background: #fff; cursor: pointer; }
.osa-messages { padding: 14px; overflow: auto; background: #ffffff; }
.osa-empty { color: #667085; font-size: 14px; padding: 12px 4px; }
.osa-message { display: flex; flex-direction: column; margin: 8px 0; }
.osa-message-text { max-width: 82%; padding: 10px 12px; border-radius: 8px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.osa-message.is-user { align-items: flex-end; }
.osa-message.is-user .osa-message-text { background: #3158f5; color: #fff; }
.osa-message.is-agent .osa-message-text { background: #f2f4f7; color: #111827; }
.osa-message.is-system .osa-message-text { align-self: center; background: #fff7ed; color: #9a3412; font-size: 12px; }
.osa-sources { margin-top: 4px; color: #667085; font-size: 11px; }
.osa-error { margin: 8px 0; padding: 10px 12px; border-radius: 8px; background: #fef2f2; color: #b42318; font-size: 13px; }
.osa-composer { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; padding: 12px; border-top: 1px solid #e6e9f0; background: #f8fafc; }
.osa-composer input { min-width: 0; height: 40px; border: 1px solid #d0d5dd; border-radius: 6px; padding: 0 10px; font-size: 14px; background: #fff; }
.osa-handoff, .osa-send { height: 40px; border: 0; border-radius: 6px; padding: 0 12px; font-weight: 600; cursor: pointer; }
.osa-handoff { background: #eef2ff; color: #3158f5; }
.osa-send { background: #101828; color: #fff; }
@media (max-width: 520px) {
  .osa-bubble { right: 16px; bottom: 16px; }
  .osa-panel { right: 16px; bottom: 84px; height: min(560px, calc(100vh - 108px)); }
}
`;
