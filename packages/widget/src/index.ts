import type { ClientEvent, Message } from "@opensupportai/protocol";

export type OpenSupportAIWidgetOptions = {
  apiUrl?: string;
  projectId: string;
  publicKey?: string;
  conversationToken?: string;
  /** @deprecated Pass a conversation capability token as conversationToken. */
  userToken?: string;
  pollIntervalMs?: number;
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

type WidgetCopy = {
  openChat: string;
  closeChat: string;
  support: string;
  empty: string;
  handoff: string;
  inputPlaceholder: string;
  send: string;
  connectFailed: string;
  sendFailed: string;
  handoffFailed: string;
  handoffRequested: string;
  handoffNote: string;
  sessionExpired: string;
  retry: string;
  startNew: string;
};

type RecoveryAction = {
  label: string;
  run: () => Promise<void>;
};

export function init(options: OpenSupportAIWidgetOptions): OpenSupportAIWidgetController {
  const client = new OpenSupportAIWidgetClient({
    apiUrl: options.apiUrl ?? "http://localhost:4000",
    projectId: options.projectId,
    publicKey: options.publicKey,
    conversationToken: options.conversationToken,
    userToken: options.userToken,
    pollIntervalMs: options.pollIntervalMs
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
  private recoveryAction: RecoveryAction | undefined;
  private readonly copy: WidgetCopy;
  private readonly createIdempotencyKey = requestIdempotencyKey();

  constructor(
    private readonly client: OpenSupportAIWidgetClient,
    private readonly options: OpenSupportAIWidgetOptions,
    private readonly mount: HTMLElement
  ) {
    this.shadowRoot = mount.attachShadow({ mode: "open" });
    this.copy = resolveWidgetCopy(options.locale);
    const storageKey = this.storageKey();
    const stored = readStoredConversation(sessionStorage.getItem(storageKey));
    const storedIsExpired = stored?.conversationTokenExpiresAt
      ? Date.parse(stored.conversationTokenExpiresAt) <= Date.now()
      : false;
    if (stored && !storedIsExpired) {
      this.conversationId = stored.conversationId;
      this.client.setConversationToken(stored.conversationId, stored.conversationToken);
    } else if (storedIsExpired) {
      sessionStorage.removeItem(storageKey);
    }
    localStorage.removeItem(storageKey);
  }

  render(): void {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <button class="osa-bubble" aria-label="${escapeHtml(this.open ? this.copy.closeChat : this.copy.openChat)}">${this.open ? "×" : "?"}</button>
      <section class="osa-panel ${this.open ? "is-open" : ""}" aria-live="polite">
        <header class="osa-header">
          <div>
            <strong>OpenSupportAI</strong>
            <span>${escapeHtml(this.copy.support)}</span>
          </div>
          <button class="osa-icon" aria-label="${escapeHtml(this.copy.closeChat)}">×</button>
        </header>
        <div class="osa-messages">
          ${this.messages.length === 0 ? `<div class="osa-empty">${escapeHtml(this.copy.empty)}</div>` : ""}
          ${this.messages.map((message) => this.renderMessage(message)).join("")}
          ${
            this.error
              ? `<div class="osa-error" role="alert">
                  <span>${escapeHtml(this.error)}</span>
                  ${
                    this.recoveryAction
                      ? `<button type="button" class="osa-retry">${escapeHtml(this.recoveryAction.label)}</button>`
                      : ""
                  }
                </div>`
              : ""
          }
        </div>
        <form class="osa-composer">
          <button type="button" class="osa-handoff">${escapeHtml(this.copy.handoff)}</button>
          <input name="text" autocomplete="off" placeholder="${escapeHtml(this.copy.inputPlaceholder)}" ${this.sending ? "disabled" : ""} />
          <button type="submit" class="osa-send" ${this.sending ? "disabled" : ""}>${escapeHtml(this.copy.send)}</button>
        </form>
      </section>
    `;

    this.shadowRoot.querySelector(".osa-bubble")?.addEventListener("click", () => {
      this.open = !this.open;
      this.render();
      if (this.open) {
        void this.openConversation();
      }
    });
    this.shadowRoot.querySelector(".osa-icon")?.addEventListener("click", () => {
      this.open = false;
      this.render();
    });
    this.shadowRoot.querySelector(".osa-handoff")?.addEventListener("click", () => {
      void this.requestHandoff();
    });
    this.shadowRoot.querySelector(".osa-retry")?.addEventListener("click", () => {
      void this.runRecoveryAction();
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

  private async openConversation(): Promise<void> {
    try {
      this.clearError();
      await this.ensureConversation();
    } catch (error) {
      this.setRecoverableError(error, this.copy.connectFailed, () => this.openConversation());
      this.render();
    }
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
      },
      idempotencyKey: this.createIdempotencyKey
    });
    this.conversationId = conversation.conversationId;
    sessionStorage.setItem(
      this.storageKey(),
      JSON.stringify({
        conversationId: conversation.conversationId,
        conversationToken: conversation.conversationToken,
        conversationTokenExpiresAt: conversation.conversationTokenExpiresAt
      })
    );
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

  private async send(text: string, idempotencyKey = requestIdempotencyKey()): Promise<void> {
    this.sending = true;
    this.clearError();
    this.render();
    try {
      const conversationId = await this.ensureConversation();
      await this.client.sendMessage({
        conversationId,
        text,
        idempotencyKey
      });
      await this.refreshMessages();
    } catch (error) {
      this.setRecoverableError(error, this.copy.sendFailed, () => this.send(text, idempotencyKey));
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
        note: this.copy.handoffNote
      });
      this.messages = [
        ...this.messages,
        syntheticMessage(conversationId, "system", this.copy.handoffRequested)
      ];
      this.clearError();
      this.render();
    } catch (error) {
      this.setRecoverableError(error, this.copy.handoffFailed, () => this.requestHandoff());
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
        syntheticMessage(event.data.conversationId, "system", this.copy.handoffRequested)
      ];
      this.render();
    }
    if (event.event === "support.error") {
      this.error = event.data.message;
      this.recoveryAction = {
        label: this.copy.retry,
        run: () => this.openConversation()
      };
      this.render();
    }
  }

  private setRecoverableError(
    error: unknown,
    fallbackMessage: string,
    retry: () => Promise<void>
  ): void {
    const authorizationFailed =
      error instanceof OpenSupportAIRequestError && (error.status === 401 || error.status === 403);
    this.error = authorizationFailed ? this.copy.sessionExpired : fallbackMessage;
    this.recoveryAction = authorizationFailed
      ? {
          label: this.copy.startNew,
          run: async () => {
            this.resetConversation();
            await retry();
          }
        }
      : { label: this.copy.retry, run: retry };
  }

  private async runRecoveryAction(): Promise<void> {
    const action = this.recoveryAction;
    if (!action) {
      return;
    }
    this.clearError();
    this.render();
    await action.run();
  }

  private clearError(): void {
    this.error = undefined;
    this.recoveryAction = undefined;
  }

  private resetConversation(): void {
    if (this.conversationId) {
      this.client.forgetConversationToken(this.conversationId);
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.conversationId = undefined;
    this.messages = [];
    sessionStorage.removeItem(this.storageKey());
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
    Pick<
      OpenSupportAIWidgetOptions,
      "publicKey" | "conversationToken" | "userToken" | "pollIntervalMs"
    >;
  private readonly conversationTokens = new Map<string, string>();

  constructor(options: {
    apiUrl: string;
    projectId: string;
    publicKey?: string;
    conversationToken?: string;
    userToken?: string;
    pollIntervalMs?: number;
  }) {
    this.options = options;
  }

  setConversationToken(conversationId: string, token: string): void {
    this.conversationTokens.set(conversationId, token);
  }

  forgetConversationToken(conversationId: string): void {
    this.conversationTokens.delete(conversationId);
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
    idempotencyKey?: string;
  }): Promise<{
    conversationId: string;
    status: string;
    conversationToken: string;
    conversationTokenExpiresAt: string;
  }> {
    const response = await this.request<{
      conversation_id: string;
      status: string;
      conversation_token: string;
      conversation_token_expires_at: string;
      idempotent?: boolean;
    }>(
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
        }),
        headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : undefined
      },
      { kind: "project" }
    );
    this.conversationTokens.set(response.conversation_id, response.conversation_token);
    return {
      conversationId: response.conversation_id,
      status: response.status,
      conversationToken: response.conversation_token,
      conversationTokenExpiresAt: response.conversation_token_expires_at
    };
  }

  async sendMessage(input: {
    conversationId: string;
    text: string;
    idempotencyKey?: string;
  }): Promise<{ messageId: string; conversationId: string; status: string }> {
    const response = await this.request<{
      message_id: string;
      conversation_id: string;
      status: string;
      idempotent?: boolean;
    }>(
      `/v1/client/conversations/${input.conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "text",
          text: input.text
        }),
        headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : undefined
      },
      {
        kind: "conversation",
        conversationId: input.conversationId
      }
    );
    return {
      messageId: response.message_id,
      conversationId: response.conversation_id,
      status: response.status
    };
  }

  async listMessages(
    conversationId: string,
    options: { limit?: number; after?: string } = {}
  ): Promise<{ messages: Message[]; nextCursor?: string }> {
    const query = new URLSearchParams();
    if (options.limit) {
      query.set("limit", String(options.limit));
    }
    if (options.after) {
      query.set("after", options.after);
    }
    const response = await this.request<{ messages: Message[]; next_cursor?: string }>(
      `/v1/client/conversations/${conversationId}/messages${query.size ? `?${query}` : ""}`,
      {
        method: "GET"
      },
      {
        kind: "conversation",
        conversationId
      }
    );
    return { messages: response.messages, nextCursor: response.next_cursor };
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
      },
      { kind: "conversation", conversationId: input.conversationId }
    );
    return {
      conversationId: response.conversation_id,
      status: response.status
    };
  }

  subscribe(conversationId: string, handler: (event: ClientEvent) => void): () => void {
    let eventSource: EventSource | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempts = 0;
    let pollCursor: string | undefined;
    let stopped = false;
    const seenMessageIds = new Set<string>();
    const eventNames = [
      "message.created",
      "ai.delta",
      "ai.message.completed",
      "handoff.requested",
      "human.message.created",
      "conversation.status_changed",
      "support.error"
    ] as const;

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };
    const poll = async () => {
      try {
        const response = await this.listMessages(conversationId, {
          limit: 100,
          after: pollCursor
        });
        for (const message of response.messages) {
          if (seenMessageIds.has(message.id)) {
            continue;
          }
          seenMessageIds.add(message.id);
          handler({
            event:
              message.role === "human_agent"
                ? "human.message.created"
                : message.role === "ai_agent"
                  ? "ai.message.completed"
                  : "message.created",
            data: { message }
          });
        }
        pollCursor = response.nextCursor ?? response.messages.at(-1)?.id ?? pollCursor;
      } catch {
        // Polling is a fallback; a later interval or stream reconnect can recover.
      }
    };
    const startPolling = () => {
      if (stopped || pollTimer) {
        return;
      }
      void poll();
      pollTimer = setInterval(() => void poll(), this.options.pollIntervalMs ?? 4_000);
    };
    const scheduleReconnect = () => {
      if (stopped || reconnectTimer || typeof EventSource === "undefined") {
        return;
      }
      const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempts, 5));
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delayMs);
    };
    const connect = async () => {
      if (stopped || typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      try {
        const stream = await this.request<{ stream_token: string; expires_at: string }>(
          `/v1/client/conversations/${conversationId}/stream-token`,
          { method: "POST" },
          { kind: "conversation", conversationId }
        );
        if (stopped) {
          return;
        }
        const url = new URL(
          `${this.options.apiUrl}/v1/client/conversations/${conversationId}/events`
        );
        url.searchParams.set("stream_token", stream.stream_token);
        eventSource = new EventSource(url.toString());
        eventSource.onopen = () => {
          reconnectAttempts = 0;
          stopPolling();
        };
        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = undefined;
          startPolling();
          scheduleReconnect();
        };
        for (const eventName of eventNames) {
          eventSource.addEventListener(eventName, (event) => {
            if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
              return;
            }
            try {
              const clientEvent = {
                event: eventName,
                data: JSON.parse(event.data)
              } as ClientEvent;
              rememberEventMessage(clientEvent, seenMessageIds);
              handler(clientEvent);
            } catch {
              // Ignore malformed transport frames and wait for the next valid event.
            }
          });
        }
      } catch {
        startPolling();
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      stopped = true;
      eventSource?.close();
      stopPolling();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    auth:
      | { kind: "project" }
      | {
          kind: "conversation";
          conversationId: string;
        }
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    for (const [name, value] of Object.entries(this.authHeaders(auth))) {
      headers.set(name, value);
    }
    const response = await fetch(`${this.options.apiUrl}${path}`, {
      ...init,
      headers
    });
    if (!response.ok) {
      throw new OpenSupportAIRequestError(response.status);
    }
    return response.json() as Promise<T>;
  }

  private authHeaders(
    auth:
      | { kind: "project" }
      | {
          kind: "conversation";
          conversationId: string;
        }
  ): Record<string, string> {
    if (auth.kind === "conversation") {
      const token =
        this.conversationTokens.get(auth.conversationId) ??
        this.options.conversationToken ??
        this.options.userToken;
      if (!token) {
        throw new Error("A conversation capability token is required");
      }
      return {
        Authorization: `Bearer ${token}`
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

function readStoredConversation(value: string | null):
  | {
      conversationId: string;
      conversationToken: string;
      conversationTokenExpiresAt?: string;
    }
  | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    return typeof record["conversationId"] === "string" &&
      typeof record["conversationToken"] === "string"
      ? {
          conversationId: record["conversationId"],
          conversationToken: record["conversationToken"],
          conversationTokenExpiresAt:
            typeof record["conversationTokenExpiresAt"] === "string"
              ? record["conversationTokenExpiresAt"]
              : undefined
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function rememberEventMessage(event: ClientEvent, seenMessageIds: Set<string>): void {
  if (
    event.event === "message.created" ||
    event.event === "ai.message.completed" ||
    event.event === "human.message.created"
  ) {
    seenMessageIds.add(event.data.message.id);
  }
}

function requestIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `widget-${Date.now()}-${Math.random()}`;
}

class OpenSupportAIRequestError extends Error {
  constructor(readonly status: number) {
    super(`OpenSupportAI request failed with status ${status}`);
    this.name = "OpenSupportAIRequestError";
  }
}

function resolveWidgetCopy(locale: string | undefined): WidgetCopy {
  const resolvedLocale = (locale ?? globalThis.navigator?.language ?? "en").toLowerCase();
  return resolvedLocale.startsWith("zh") ? widgetCopyZh : widgetCopyEn;
}

const widgetCopyEn: WidgetCopy = {
  openChat: "Open support chat",
  closeChat: "Close support chat",
  support: "Support",
  empty: "How can we help?",
  handoff: "Human",
  inputPlaceholder: "Type your question",
  send: "Send",
  connectFailed: "Support could not be loaded.",
  sendFailed: "Your message could not be sent.",
  handoffFailed: "Human support could not be requested.",
  handoffRequested: "A human support request has been sent.",
  handoffNote: "Requested from widget",
  sessionExpired: "This support session has expired.",
  retry: "Retry",
  startNew: "Start new chat"
};

const widgetCopyZh: WidgetCopy = {
  openChat: "打开客服对话",
  closeChat: "关闭客服对话",
  support: "客户支持",
  empty: "有什么可以帮你？",
  handoff: "人工客服",
  inputPlaceholder: "输入问题",
  send: "发送",
  connectFailed: "暂时无法加载客服对话。",
  sendFailed: "消息发送失败。",
  handoffFailed: "暂时无法请求人工客服。",
  handoffRequested: "已请求人工客服。",
  handoffNote: "用户从客服组件请求人工支持",
  sessionExpired: "本次客服会话已过期。",
  retry: "重试",
  startNew: "开始新会话"
};

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
.osa-error { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; padding: 10px 12px; border-radius: 8px; background: #fef2f2; color: #b42318; font-size: 13px; }
.osa-retry { flex: 0 0 auto; min-height: 32px; border: 1px solid #fda29b; border-radius: 6px; padding: 0 10px; background: #fff; color: #b42318; font-weight: 600; cursor: pointer; }
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
