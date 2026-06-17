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
  userToken?: string;
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
};

export type SendMessageInput = {
  conversationId: string;
  text: string;
};

export type ListMessagesResponse = {
  messages: Message[];
};

type ApiCreateConversationResponse = {
  conversation_id: string;
  status: ConversationStatus;
};

type ApiSendMessageResponse = {
  message_id: string;
  conversation_id: string;
  status: "accepted";
};

type ApiRequestHandoffResponse = {
  conversation_id: string;
  status: "handoff_requested" | "handed_off";
};

export class OpenSupportAIClient {
  readonly options: OpenSupportAIClientOptions;

  constructor(options: OpenSupportAIClientOptions) {
    this.options = options;
  }

  async createConversation(input: CreateConversationInput): Promise<CreateConversationResponse> {
    const response = await this.request<ApiCreateConversationResponse>("/v1/client/conversations", {
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
    });

    return {
      conversationId: response.conversation_id,
      status: response.status
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
        })
      }
    );

    return {
      messageId: response.message_id,
      conversationId: response.conversation_id,
      status: response.status
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
      }
    );

    return {
      conversationId: response.conversation_id,
      status: response.status
    };
  }

  listMessages(conversationId: string): Promise<ListMessagesResponse> {
    return this.request(`/v1/client/conversations/${conversationId}/messages`, {
      method: "GET"
    });
  }

  subscribe(conversationId: string, handler: EventHandler): () => void {
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
