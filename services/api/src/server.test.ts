import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./server";

describe("OpenSupportAI API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: {
        nodeEnv: "test",
        port: 0,
        storageMode: "memory",
        adminToken: "admin_demo_key",
        encryptionKey: "test_encryption_key",
        corsOrigin: true
      }
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs the grounded client conversation flow", async () => {
    const conversationResponse = await app.inject({
      method: "POST",
      url: "/v1/client/conversations",
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        project_id: "proj_demo",
        inbox_id: "inbox_default",
        contact: {
          external_user_id: "user_123",
          name: "张三",
          email: "zhangsan@example.com"
        },
        metadata: {
          page_url: "https://app.example.com/billing"
        }
      }
    });

    expect(conversationResponse.statusCode).toBe(200);
    const conversation = conversationResponse.json<{ conversation_id: string; status: string }>();
    expect(conversation.status).toBe("open");

    const sseResponse = await app.inject({
      method: "GET",
      url: `/v1/client/conversations/${conversation.conversation_id}/events?once=true`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      }
    });
    expect(sseResponse.statusCode).toBe(200);
    expect(sseResponse.body).toContain("event: conversation.status_changed");

    const sendResponse = await app.inject({
      method: "POST",
      url: `/v1/client/conversations/${conversation.conversation_id}/messages`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        type: "text",
        text: "怎么取消订阅？"
      }
    });

    expect(sendResponse.statusCode).toBe(200);
    expect(sendResponse.json<{ status: string }>().status).toBe("accepted");

    const messagesResponse = await app.inject({
      method: "GET",
      url: `/v1/client/conversations/${conversation.conversation_id}/messages`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      }
    });
    expect(messagesResponse.statusCode).toBe(200);
    const messages = messagesResponse.json<{
      messages: Array<{ role: string; content: { text?: string } }>;
    }>();
    expect(messages.messages.map((message) => message.role)).toContain("end_user");
    expect(messages.messages.map((message) => message.role)).toContain("ai_agent");
    expect(messages.messages.at(-1)?.content.text).toContain("取消订阅");

    const adminResponse = await app.inject({
      method: "GET",
      url: `/v1/admin/projects/proj_demo/conversations/${conversation.conversation_id}`,
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    expect(adminResponse.statusCode).toBe(200);
    const adminPayload = adminResponse.json<{
      ai_runs: Array<{ status: string; retrievedChunkIds: string[] }>;
    }>();
    expect(adminPayload.ai_runs[0]?.status).toBe("completed");
    expect(adminPayload.ai_runs[0]?.retrievedChunkIds.length).toBeGreaterThan(0);
  });

  it("does not fabricate answers when knowledge retrieval misses", async () => {
    const conversationResponse = await app.inject({
      method: "POST",
      url: "/v1/client/conversations",
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        project_id: "proj_demo",
        inbox_id: "inbox_default",
        contact: {
          external_user_id: "user_unknown"
        }
      }
    });
    const conversation = conversationResponse.json<{ conversation_id: string }>();

    await app.inject({
      method: "POST",
      url: `/v1/client/conversations/${conversation.conversation_id}/messages`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        type: "text",
        text: "火星基地的停车费是多少？"
      }
    });

    const messagesResponse = await app.inject({
      method: "GET",
      url: `/v1/client/conversations/${conversation.conversation_id}/messages`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      }
    });
    const messages = messagesResponse.json<{
      messages: Array<{ role: string; content: { text?: string } }>;
    }>();
    expect(messages.messages.at(-1)?.role).toBe("ai_agent");
    expect(messages.messages.at(-1)?.content.text).toContain("无法根据当前知识库确认");
  });

  it("handles explicit handoff requests", async () => {
    const conversationResponse = await app.inject({
      method: "POST",
      url: "/v1/client/conversations",
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        project_id: "proj_demo",
        inbox_id: "inbox_default",
        contact: {
          external_user_id: "user_handoff"
        }
      }
    });
    const conversation = conversationResponse.json<{ conversation_id: string }>();

    const handoffResponse = await app.inject({
      method: "POST",
      url: `/v1/client/conversations/${conversation.conversation_id}/handoff`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        reason: "user_requested",
        note: "用户要求退款人工审核"
      }
    });

    expect(handoffResponse.statusCode).toBe(200);
    expect(handoffResponse.json<{ status: string }>().status).toBe("handoff_requested");
  });

  it("creates Chatwoot handoff conversations and maps replies by external id", async () => {
    const chatwootCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const chatwootFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      chatwootCalls.push({ url, body });

      if (url.endsWith("/contacts")) {
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
                      id: 1
                    }
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.endsWith("/conversations")) {
        return new Response(JSON.stringify({ id: 91 }), { status: 200 });
      }

      if (url.endsWith("/conversations/91/messages")) {
        return new Response(JSON.stringify({ id: 100 }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected url" }), { status: 404 });
    };

    const chatwootApp = await buildApp({
      config: {
        nodeEnv: "test",
        port: 0,
        storageMode: "memory",
        adminToken: "admin_demo_key",
        encryptionKey: "test_encryption_key",
        corsOrigin: true
      },
      chatwootFetch
    });
    await chatwootApp.ready();

    try {
      const integrationResponse = await chatwootApp.inject({
        method: "POST",
        url: "/v1/admin/projects/proj_demo/integrations/chatwoot",
        headers: {
          authorization: "Bearer admin_demo_key"
        },
        payload: {
          base_url: "http://chatwoot.test",
          account_id: "1",
          inbox_id: "1",
          api_access_token: "chatwoot_token",
          webhook_secret: "chatwoot_secret",
          status: "active"
        }
      });
      expect(integrationResponse.statusCode).toBe(200);

      const conversationResponse = await chatwootApp.inject({
        method: "POST",
        url: "/v1/client/conversations",
        headers: {
          "x-opensupportai-public-key": "pk_demo"
        },
        payload: {
          project_id: "proj_demo",
          inbox_id: "inbox_default",
          contact: {
            external_user_id: "user_chatwoot_connected",
            name: "Chatwoot User",
            email: "connected@example.com"
          },
          metadata: {
            page_url: "https://app.example.com/billing"
          }
        }
      });
      const conversation = conversationResponse.json<{ conversation_id: string }>();

      await chatwootApp.inject({
        method: "POST",
        url: `/v1/client/conversations/${conversation.conversation_id}/messages`,
        headers: {
          "x-opensupportai-public-key": "pk_demo"
        },
        payload: {
          type: "text",
          text: "怎么取消订阅？"
        }
      });

      const handoffResponse = await chatwootApp.inject({
        method: "POST",
        url: `/v1/client/conversations/${conversation.conversation_id}/handoff`,
        headers: {
          "x-opensupportai-public-key": "pk_demo"
        },
        payload: {
          reason: "user_requested",
          note: "用户想确认退款政策"
        }
      });

      expect(handoffResponse.statusCode).toBe(200);
      expect(handoffResponse.json<{ status: string }>().status).toBe("handed_off");
      expect(chatwootCalls[0]).toMatchObject({
        url: "http://chatwoot.test/api/v1/accounts/1/contacts",
        body: {
          inbox_id: 1,
          email: "connected@example.com",
          identifier: "user_chatwoot_connected"
        }
      });
      expect(chatwootCalls[1]).toMatchObject({
        url: "http://chatwoot.test/api/v1/accounts/1/conversations",
        body: {
          source_id: "source_42",
          inbox_id: 1,
          contact_id: 42,
          status: "open",
          custom_attributes: {
            opensupportai_project_id: "proj_demo",
            opensupportai_conversation_id: conversation.conversation_id
          }
        }
      });
      expect(
        chatwootCalls.some(
          (call) =>
            call.url === "http://chatwoot.test/api/v1/accounts/1/conversations/91/messages" &&
            call.body["private"] === true &&
            String(call.body["content"]).includes("OpenSupportAI handoff summary")
        )
      ).toBe(true);
      expect(
        chatwootCalls.some(
          (call) =>
            call.body["message_type"] === "incoming" &&
            String(call.body["content"]).includes("怎么取消订阅")
        )
      ).toBe(true);

      const adminResponse = await chatwootApp.inject({
        method: "GET",
        url: `/v1/admin/projects/proj_demo/conversations/${conversation.conversation_id}`,
        headers: {
          authorization: "Bearer admin_demo_key"
        }
      });
      expect(adminResponse.json<{ conversation: { status: string } }>().conversation.status).toBe(
        "handed_off"
      );

      const webhookResponse = await chatwootApp.inject({
        method: "POST",
        url: "/v1/webhooks/chatwoot/proj_demo",
        headers: {
          "x-opensupportai-signature": "chatwoot_secret"
        },
        payload: {
          id: "cw_msg_external_1",
          event: "message_created",
          message_type: "outgoing",
          private: false,
          content: "我已经看到你前面的对话记录。",
          conversation: {
            id: 91
          }
        }
      });
      expect(webhookResponse.statusCode).toBe(200);
      expect(webhookResponse.json<{ status: string }>().status).toBe("ok");

      const messagesResponse = await chatwootApp.inject({
        method: "GET",
        url: `/v1/client/conversations/${conversation.conversation_id}/messages`,
        headers: {
          "x-opensupportai-public-key": "pk_demo"
        }
      });
      const messages = messagesResponse.json<{
        messages: Array<{ role: string; content: { text?: string } }>;
      }>();
      expect(
        messages.messages.some(
          (message) =>
            message.role === "human_agent" &&
            message.content.text?.includes("我已经看到你前面的对话记录")
        )
      ).toBe(true);
    } finally {
      await chatwootApp.close();
    }
  });

  it("maps public Chatwoot agent replies back into local messages", async () => {
    const conversationResponse = await app.inject({
      method: "POST",
      url: "/v1/client/conversations",
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        project_id: "proj_demo",
        inbox_id: "inbox_default",
        contact: {
          external_user_id: "user_chatwoot"
        }
      }
    });
    const conversation = conversationResponse.json<{ conversation_id: string }>();

    await app.inject({
      method: "POST",
      url: `/v1/client/conversations/${conversation.conversation_id}/handoff`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        reason: "user_requested"
      }
    });

    const integrationResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/projects/proj_demo/integrations/chatwoot",
      headers: {
        authorization: "Bearer admin_demo_key"
      },
      payload: {
        base_url: "http://localhost:3008",
        account_id: "1",
        inbox_id: "1",
        api_access_token: "chatwoot_token",
        webhook_secret: "chatwoot_secret",
        status: "active"
      }
    });
    expect(integrationResponse.statusCode).toBe(200);

    const webhookResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/chatwoot/proj_demo",
      headers: {
        "x-opensupportai-signature": "chatwoot_secret"
      },
      payload: {
        id: "cw_msg_1",
        event: "message_created",
        message_type: "outgoing",
        private: false,
        content: "人工客服已经接入，我来继续处理。",
        conversation: {
          id: 91,
          custom_attributes: {
            opensupportai_conversation_id: conversation.conversation_id
          }
        }
      }
    });

    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.json<{ status: string }>().status).toBe("ok");

    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/chatwoot/proj_demo",
      headers: {
        "x-opensupportai-signature": "chatwoot_secret"
      },
      payload: {
        id: "cw_msg_1",
        event: "message_created",
        message_type: "outgoing",
        private: false,
        content: "人工客服已经接入，我来继续处理。",
        conversation: {
          id: 91,
          custom_attributes: {
            opensupportai_conversation_id: conversation.conversation_id
          }
        }
      }
    });
    expect(duplicateResponse.statusCode).toBe(200);
    expect(duplicateResponse.json<{ status: string }>().status).toBe("duplicate");

    const messagesResponse = await app.inject({
      method: "GET",
      url: `/v1/client/conversations/${conversation.conversation_id}/messages`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      }
    });
    const messages = messagesResponse.json<{
      messages: Array<{ role: string; content: { text?: string } }>;
    }>();
    const humanMessages = messages.messages.filter((message) => message.role === "human_agent");
    expect(humanMessages).toHaveLength(1);
    expect(humanMessages[0]?.content.text).toContain("人工客服已经接入");
  });

  it("lets admins create knowledge documents", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/projects/proj_demo/knowledge/documents",
      headers: {
        authorization: "Bearer admin_demo_key"
      },
      payload: {
        title: "登录问题",
        source_type: "markdown",
        content: "如果用户忘记密码，可以在登录页点击忘记密码并通过邮箱重置。",
        metadata: {
          locale: "zh-CN"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ document: { status: string } }>().document.status).toBe("indexed");
  });
});
