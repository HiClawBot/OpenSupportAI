import type { ExternalConversationRef } from "@opensupportai/protocol";

export type ChatwootAdapterConfig = {
  baseUrl: string;
  accountId: string;
  inboxId: string;
  apiAccessToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export interface ChatwootHandoffAdapter {
  provider: "chatwoot";
  createOrUpdateContact(input: CreateContactInput): Promise<ExternalContactRef>;
  createConversation(input: CreateConversationInput): Promise<ExternalConversationRef>;
  pushMessage(input: PushMessageInput): Promise<void>;
  handleWebhook(input: WebhookInput): Promise<WebhookResult>;
}

export type CreateContactInput = {
  projectId: string;
  contactId: string;
  name?: string;
  email?: string;
  externalUserId?: string;
};

export type ExternalContactRef = {
  provider: "chatwoot";
  externalContactId: string;
  externalContactSourceId?: string;
};

export type CreateConversationInput = {
  projectId: string;
  conversationId: string;
  externalContactId: string;
  externalContactSourceId?: string;
  summary?: string;
};

export type PushMessageInput = {
  projectId: string;
  externalConversationId: string;
  message: {
    role: "end_user" | "ai_agent" | "system";
    text: string;
  };
};

export type WebhookInput = {
  projectId: string;
  headers: Record<string, string | undefined>;
  payload: unknown;
};

export type WebhookResult = {
  accepted: boolean;
  externalConversationId?: string;
  text?: string;
};

export function createChatwootAdapter(config: ChatwootAdapterConfig): ChatwootHandoffAdapter {
  const client = new ChatwootApiClient(config);
  return {
    provider: "chatwoot",
    async createOrUpdateContact(input) {
      const response = await client.post<ChatwootContactResponse>(`/contacts`, {
        inbox_id: numericString(config.inboxId),
        name: input.name ?? input.externalUserId ?? input.contactId,
        email: input.email,
        identifier: input.externalUserId ?? input.contactId,
        additional_attributes: {
          opensupportai_project_id: input.projectId,
          opensupportai_contact_id: input.contactId
        },
        custom_attributes: {
          opensupportai_project_id: input.projectId,
          opensupportai_contact_id: input.contactId
        }
      });
      const contactRecord = contactRecordFromResponse(response);
      const contactId = response.id ?? valueFromRecord(contactRecord, "id");
      if (!contactId) {
        throw new Error("Chatwoot contact response did not include an id");
      }
      return {
        provider: "chatwoot",
        externalContactId: String(contactId),
        externalContactSourceId: sourceIdFromContact(contactRecord, config.inboxId)
      };
    },
    async createConversation(input) {
      const response = await client.post<{ id?: number | string }>(`/conversations`, {
        source_id: input.externalContactSourceId ?? input.conversationId,
        inbox_id: numericString(config.inboxId),
        contact_id: numericString(input.externalContactId),
        custom_attributes: {
          opensupportai_project_id: input.projectId,
          opensupportai_conversation_id: input.conversationId
        },
        status: "open"
      });
      const conversationId = response.id;
      if (!conversationId) {
        throw new Error("Chatwoot conversation response did not include an id");
      }
      if (input.summary) {
        await client.post(`/conversations/${conversationId}/messages`, {
          content: input.summary,
          message_type: "outgoing",
          private: true
        });
      }
      return {
        provider: "chatwoot",
        externalConversationId: String(conversationId)
      };
    },
    async pushMessage(input) {
      await client.post(`/conversations/${input.externalConversationId}/messages`, {
        content: input.message.text,
        message_type: input.message.role === "end_user" ? "incoming" : "outgoing",
        private: input.message.role === "system",
        content_type: "text"
      });
    },
    async handleWebhook(input) {
      const payload = normalizeWebhookPayload(input.payload);
      return {
        accepted: payload.messageType === "outgoing" && !payload.private,
        externalConversationId: payload.conversationId,
        text: payload.content
      };
    }
  };
}

type ChatwootContactResponse = {
  id?: number | string;
  source_id?: number | string;
  payload?: unknown;
  contact_inboxes?: unknown;
};

class ChatwootApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ChatwootAdapterConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: this.config.apiAccessToken
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000)
    });

    if (!response.ok) {
      throw new Error(`Chatwoot request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}/api/v1/accounts/${this.config.accountId}${path}`;
  }
}

function contactRecordFromResponse(response: ChatwootContactResponse): Record<string, unknown> {
  const payload = response.payload;
  if (Array.isArray(payload)) {
    return recordValue(payload[0]) ?? response;
  }

  const payloadRecord = recordValue(payload);
  const nestedContact = recordValue(payloadRecord?.["contact"]);
  return nestedContact ?? payloadRecord ?? response;
}

function sourceIdFromContact(
  contact: Record<string, unknown>,
  inboxId: string
): string | undefined {
  const contactInboxes = contact["contact_inboxes"];
  if (!Array.isArray(contactInboxes)) {
    return stringValue(contact["source_id"]);
  }

  const matchingInbox =
    contactInboxes.find((item) => {
      const record = recordValue(item);
      const inbox = recordValue(record?.["inbox"]);
      const id = stringValue(inbox?.["id"]);
      return id === inboxId;
    }) ?? contactInboxes[0];

  return stringValue(recordValue(matchingInbox)?.["source_id"]);
}

function numericString(value: string): number | string {
  return /^\d+$/.test(value) ? Number(value) : value;
}

function valueFromRecord(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function normalizeWebhookPayload(payload: unknown): {
  conversationId?: string;
  content?: string;
  messageType?: string;
  private?: boolean;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const conversation = record["conversation"];
  const conversationRecord =
    conversation && typeof conversation === "object" && !Array.isArray(conversation)
      ? (conversation as Record<string, unknown>)
      : {};
  const id = record["conversation_id"] ?? conversationRecord["id"];
  return {
    conversationId: typeof id === "string" || typeof id === "number" ? String(id) : undefined,
    content: typeof record["content"] === "string" ? record["content"] : undefined,
    messageType: typeof record["message_type"] === "string" ? record["message_type"] : undefined,
    private: typeof record["private"] === "boolean" ? record["private"] : undefined
  };
}
