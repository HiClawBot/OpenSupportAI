import { describe, expect, it } from "vitest";
import { createChatwootAdapter } from "./index";

describe("chatwoot adapter skeleton", () => {
  it("creates an adapter instance", () => {
    const adapter = createChatwootAdapter({
      baseUrl: "http://localhost:3008",
      accountId: "1",
      inboxId: "1",
      apiAccessToken: "token"
    });

    expect(adapter.provider).toBe("chatwoot");
  });

  it("creates contacts through the Chatwoot API", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const adapter = createChatwootAdapter({
      baseUrl: "http://chatwoot.test",
      accountId: "1",
      inboxId: "2",
      apiAccessToken: "token",
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({
            id: 42,
            payload: [
              {
                id: 42,
                contact_inboxes: [
                  {
                    source_id: "source_42",
                    inbox: {
                      id: 2
                    }
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }
    });

    await expect(
      adapter.createOrUpdateContact({
        projectId: "proj_demo",
        contactId: "contact_1",
        email: "user@example.com"
      })
    ).resolves.toEqual({
      provider: "chatwoot",
      externalContactId: "42",
      externalContactSourceId: "source_42"
    });
    expect(calls[0]?.url).toBe("http://chatwoot.test/api/v1/accounts/1/contacts");
    expect(calls[0]?.body).toMatchObject({
      inbox_id: 2,
      email: "user@example.com",
      identifier: "contact_1"
    });
  });

  it("creates conversations with the contact source id", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const adapter = createChatwootAdapter({
      baseUrl: "http://chatwoot.test",
      accountId: "1",
      inboxId: "2",
      apiAccessToken: "token",
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(JSON.stringify({ id: 91 }), { status: 200 });
      }
    });

    await expect(
      adapter.createConversation({
        projectId: "proj_demo",
        conversationId: "conv_1",
        externalContactId: "42",
        externalContactSourceId: "source_42"
      })
    ).resolves.toEqual({
      provider: "chatwoot",
      externalConversationId: "91"
    });
    expect(calls[0]).toMatchObject({
      url: "http://chatwoot.test/api/v1/accounts/1/conversations",
      body: {
        source_id: "source_42",
        inbox_id: 2,
        contact_id: 42,
        status: "open"
      }
    });
  });

  it("pushes transcript messages as text messages", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const adapter = createChatwootAdapter({
      baseUrl: "http://chatwoot.test",
      accountId: "1",
      inboxId: "2",
      apiAccessToken: "token",
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(JSON.stringify({ id: 100 }), { status: 200 });
      }
    });

    await adapter.pushMessage({
      projectId: "proj_demo",
      externalConversationId: "91",
      message: {
        role: "end_user",
        text: "Need help"
      }
    });

    expect(calls[0]).toMatchObject({
      url: "http://chatwoot.test/api/v1/accounts/1/conversations/91/messages",
      body: {
        content: "Need help",
        message_type: "incoming",
        private: false,
        content_type: "text"
      }
    });
  });

  it("accepts only public outgoing webhook messages", async () => {
    const adapter = createChatwootAdapter({
      baseUrl: "http://chatwoot.test",
      accountId: "1",
      inboxId: "2",
      apiAccessToken: "token"
    });

    await expect(
      adapter.handleWebhook({
        projectId: "proj_demo",
        headers: {},
        payload: {
          conversation_id: 100,
          message_type: "outgoing",
          private: false,
          content: "Agent reply"
        }
      })
    ).resolves.toEqual({
      accepted: true,
      externalConversationId: "100",
      text: "Agent reply"
    });
  });
});
