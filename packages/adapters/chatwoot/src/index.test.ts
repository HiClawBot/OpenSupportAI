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
    const calls: string[] = [];
    const adapter = createChatwootAdapter({
      baseUrl: "http://chatwoot.test",
      accountId: "1",
      inboxId: "2",
      apiAccessToken: "token",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
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
      externalContactId: "42"
    });
    expect(calls[0]).toBe("http://chatwoot.test/api/v1/accounts/1/contacts");
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
