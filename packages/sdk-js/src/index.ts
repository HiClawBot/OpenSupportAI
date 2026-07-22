import type {
  ClientEvent,
  ConversationStatus,
  CreateConversationResponse,
  Message,
  RequestHandoffInput,
  RequestHandoffResponse,
  SendMessageResponse
} from "@opensupportai/protocol";

export type OpenSupportAIClientOptions = {
  apiUrl: string;
  projectId: string;
  publicKey?: string;
  conversationToken?: string;
  /** @deprecated Pass a conversation capability token as conversationToken. */
  userToken?: string;
  pollIntervalMs?: number;
};

export type EventHandler = (event: ClientEvent) => void;

export type CreateConversationInput = {
  inboxId?: string;
  contact?: {
    externalUserId?: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
  };
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type SendMessageInput = {
  conversationId: string;
  text: string;
  idempotencyKey?: string;
};

export type ListMessagesResponse = {
  messages: Message[];
  nextCursor?: string;
};

type ApiCreateConversationResponse = {
  conversation_id: string;
  status: ConversationStatus;
  conversation_token: string;
  conversation_token_expires_at: string;
  idempotent?: boolean;
};

type ApiSendMessageResponse = {
  message_id: string;
  conversation_id: string;
  status: "accepted";
  idempotent?: boolean;
};

type ApiListMessagesResponse = {
  messages: Message[];
  next_cursor?: string;
};

type ApiRequestHandoffResponse = {
  conversation_id: string;
  status: "handoff_requested" | "handed_off";
};

export class OpenSupportAIClient {
  readonly options: OpenSupportAIClientOptions;
  private readonly conversationTokens = new Map<string, string>();

  constructor(options: OpenSupportAIClientOptions) {
    this.options = options;
  }

  async createConversation(input: CreateConversationInput): Promise<CreateConversationResponse> {
    const response = await this.request<ApiCreateConversationResponse>(
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
      conversationTokenExpiresAt: response.conversation_token_expires_at,
      idempotent: response.idempotent
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResponse> {
    const response = await this.request<ApiSendMessageResponse>(
      `/v1/client/conversations/${input.conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "text",
          text: input.text
        }),
        headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : undefined
      },
      { kind: "conversation", conversationId: input.conversationId }
    );

    return {
      messageId: response.message_id,
      conversationId: response.conversation_id,
      status: response.status,
      idempotent: response.idempotent
    };
  }

  async requestHandoff(input: RequestHandoffInput): Promise<RequestHandoffResponse> {
    const response = await this.request<ApiRequestHandoffResponse>(
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

  async listMessages(
    conversationId: string,
    options: { limit?: number; after?: string } = {}
  ): Promise<ListMessagesResponse> {
    const query = new URLSearchParams();
    if (options.limit) {
      query.set("limit", String(options.limit));
    }
    if (options.after) {
      query.set("after", options.after);
    }
    const response = await this.request<ApiListMessagesResponse>(
      `/v1/client/conversations/${conversationId}/messages${query.size ? `?${query}` : ""}`,
      {
        method: "GET"
      },
      {
        kind: "conversation",
        conversationId
      }
    );
    return {
      messages: response.messages,
      nextCursor: response.next_cursor
    };
  }

  subscribe(conversationId: string, handler: EventHandler): () => void {
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
        // A later poll or stream reconnect can recover without surfacing duplicate UI errors.
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
              // Ignore malformed transport frames; the server event contract remains authoritative.
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
      throw new Error(`OpenSupportAI request failed with status ${response.status}`);
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

function rememberEventMessage(event: ClientEvent, seenMessageIds: Set<string>): void {
  if (
    event.event === "message.created" ||
    event.event === "ai.message.completed" ||
    event.event === "human.message.created"
  ) {
    seenMessageIds.add(event.data.message.id);
  }
}
