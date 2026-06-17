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

  it("applies fixed-window rate limits when enabled", async () => {
    const limitedApp = await buildApp({
      config: {
        nodeEnv: "test",
        port: 0,
        storageMode: "memory",
        adminToken: "admin_demo_key",
        encryptionKey: "test_encryption_key",
        corsOrigin: true,
        rateLimitEnabled: true,
        rateLimitWindowMs: 60_000,
        rateLimitMax: 2
      }
    });
    await limitedApp.ready();

    try {
      const headers = {
        authorization: "Bearer admin_demo_key"
      };

      expect(
        (
          await limitedApp.inject({
            method: "GET",
            url: "/health"
          })
        ).statusCode
      ).toBe(200);

      expect(
        (
          await limitedApp.inject({
            method: "GET",
            url: "/v1/admin/projects",
            headers
          })
        ).statusCode
      ).toBe(200);
      expect(
        (
          await limitedApp.inject({
            method: "GET",
            url: "/v1/admin/projects",
            headers
          })
        ).statusCode
      ).toBe(200);

      const limitedResponse = await limitedApp.inject({
        method: "GET",
        url: "/v1/admin/projects",
        headers
      });
      expect(limitedResponse.statusCode).toBe(429);
      expect(limitedResponse.headers["x-ratelimit-limit"]).toBe("2");
      expect(limitedResponse.json<{ error: { code: string } }>().error.code).toBe("rate_limited");
    } finally {
      await limitedApp.close();
    }
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

  it("returns enriched admin conversation summaries with filters", async () => {
    const alphaResponse = await app.inject({
      method: "POST",
      url: "/v1/client/conversations",
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        project_id: "proj_demo",
        inbox_id: "inbox_default",
        contact: {
          external_user_id: "ops_filter_alpha",
          name: "Ops Alpha",
          email: "ops-alpha@example.com"
        }
      }
    });
    const alpha = alphaResponse.json<{ conversation_id: string }>();

    await app.inject({
      method: "POST",
      url: `/v1/client/conversations/${alpha.conversation_id}/messages`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        type: "text",
        text: "怎么取消订阅？"
      }
    });

    const betaResponse = await app.inject({
      method: "POST",
      url: "/v1/client/conversations",
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        project_id: "proj_demo",
        inbox_id: "inbox_default",
        contact: {
          external_user_id: "ops_filter_beta",
          name: "Ops Beta"
        }
      }
    });
    const beta = betaResponse.json<{ conversation_id: string }>();

    await app.inject({
      method: "POST",
      url: `/v1/client/conversations/${beta.conversation_id}/handoff`,
      headers: {
        "x-opensupportai-public-key": "pk_demo"
      },
      payload: {
        reason: "user_requested"
      }
    });

    const alphaListResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects/proj_demo/conversations?q=ops_filter_alpha",
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });

    expect(alphaListResponse.statusCode).toBe(200);
    const alphaList = alphaListResponse.json<{
      conversations: Array<{
        id: string;
        contact?: { externalUserId?: string };
        messageCount: number;
        lastMessage?: { text: string; role: string };
      }>;
      summary: {
        total: number;
        filtered: number;
        byStatus: Record<string, number>;
        byAssigneeType: Record<string, number>;
        handoffStatus: Record<string, number>;
      };
      pagination: { returned: number; hasMore: boolean };
    }>();
    expect(alphaList.conversations).toHaveLength(1);
    expect(alphaList.conversations[0]).toMatchObject({
      id: alpha.conversation_id,
      contact: {
        externalUserId: "ops_filter_alpha"
      }
    });
    expect(alphaList.conversations[0]?.messageCount).toBeGreaterThanOrEqual(2);
    expect(alphaList.conversations[0]?.lastMessage?.role).toBe("ai_agent");
    expect(alphaList.summary.total).toBeGreaterThanOrEqual(2);
    expect(alphaList.summary.filtered).toBe(1);
    expect(alphaList.summary.byStatus.open).toBeGreaterThanOrEqual(1);
    expect(alphaList.summary.byAssigneeType.human).toBeGreaterThanOrEqual(1);
    expect(alphaList.pagination.returned).toBe(1);
    expect(alphaList.pagination.hasMore).toBe(false);

    const handoffListResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects/proj_demo/conversations?status=handoff_requested&q=ops_filter_beta",
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    const handoffList = handoffListResponse.json<{
      conversations: Array<{ id: string; handoff?: { status: string; provider: string } }>;
      summary: { filtered: number; handoffStatus: Record<string, number> };
    }>();
    expect(handoffList.conversations).toHaveLength(1);
    expect(handoffList.conversations[0]).toMatchObject({
      id: beta.conversation_id,
      handoff: {
        provider: "chatwoot",
        status: "requested"
      }
    });
    expect(handoffList.summary.filtered).toBe(1);
    expect(handoffList.summary.handoffStatus.requested).toBeGreaterThanOrEqual(1);
  });

  it("creates and lists async jobs for admin operations", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/projects/proj_demo/jobs",
      headers: {
        authorization: "Bearer admin_demo_key"
      },
      payload: {
        type: "knowledge.index",
        payload: {
          document_id: "doc_demo_billing"
        },
        max_attempts: 2
      }
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json<{
      job: {
        id: string;
        type: string;
        status: string;
        attempts: number;
        maxAttempts: number;
      };
    }>();
    expect(created.job).toMatchObject({
      type: "knowledge.index",
      status: "queued",
      attempts: 0,
      maxAttempts: 2
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects/proj_demo/jobs?status=queued&type=knowledge.index",
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });

    expect(listResponse.statusCode).toBe(200);
    const listed = listResponse.json<{
      jobs: Array<{ id: string; type: string; status: string }>;
    }>();
    expect(listed.jobs.some((job) => job.id === created.job.id)).toBe(true);
  });

  it("manages project API keys and records audit logs", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/projects/proj_demo/api-keys",
      headers: {
        authorization: "Bearer admin_demo_key"
      },
      payload: {
        name: "Scoped project key",
        scopes: ["admin:project"]
      }
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json<{
      key: string;
      api_key: {
        id: string;
        name: string;
        scopes: string[];
        keyHash?: string;
        lastUsedAt?: string;
      };
    }>();
    expect(created.key).toMatch(/^osa_sk_/);
    expect(created.api_key).toMatchObject({
      name: "Scoped project key",
      scopes: ["admin:project"]
    });
    expect(created.api_key.keyHash).toBeUndefined();

    const scopedProjectsResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects",
      headers: {
        authorization: `Bearer ${created.key}`
      }
    });
    expect(scopedProjectsResponse.statusCode).toBe(200);
    expect(
      scopedProjectsResponse
        .json<{ projects: Array<{ id: string }> }>()
        .projects.map((project) => project.id)
    ).toEqual(["proj_demo"]);

    const forbiddenProjectCreateResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/projects",
      headers: {
        authorization: `Bearer ${created.key}`
      },
      payload: {
        name: "Should not be created"
      }
    });
    expect(forbiddenProjectCreateResponse.statusCode).toBe(403);

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects/proj_demo/api-keys?include_revoked=true",
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    expect(listResponse.statusCode).toBe(200);
    const listed = listResponse.json<{
      api_keys: Array<{ id: string; keyHash?: string; lastUsedAt?: string }>;
    }>();
    const listedCreated = listed.api_keys.find((apiKey) => apiKey.id === created.api_key.id);
    expect(listedCreated?.keyHash).toBeUndefined();
    expect(listedCreated?.lastUsedAt).toBeDefined();

    const revokeResponse = await app.inject({
      method: "DELETE",
      url: `/v1/admin/projects/proj_demo/api-keys/${created.api_key.id}`,
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(
      revokeResponse.json<{ api_key: { revokedAt?: string } }>().api_key.revokedAt
    ).toBeDefined();

    const revokedUseResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects",
      headers: {
        authorization: `Bearer ${created.key}`
      }
    });
    expect(revokedUseResponse.statusCode).toBe(401);

    const auditResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects/proj_demo/audit-log?action=api_key.created",
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    expect(auditResponse.statusCode).toBe(200);
    const audit = auditResponse.json<{
      audit_logs: Array<{ action: string; targetId?: string; metadata: Record<string, unknown> }>;
    }>();
    expect(audit.audit_logs[0]).toMatchObject({
      action: "api_key.created",
      targetId: created.api_key.id
    });
    expect(audit.audit_logs[0]?.metadata["name"]).toBe("Scoped project key");
  });

  it("lists webhook events, schedules retries, and reports ops health", async () => {
    await app.inject({
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

    const webhookResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/chatwoot/proj_demo",
      headers: {
        "x-opensupportai-signature": "chatwoot_secret"
      },
      payload: {
        id: "cw_retry_candidate",
        event: "message_created",
        message_type: "outgoing",
        private: false,
        content: "A message without a local conversation reference"
      }
    });
    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.json<{ status: string }>().status).toBe("ignored");

    const eventsResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects/proj_demo/webhooks/events?provider=chatwoot&status=ignored",
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    expect(eventsResponse.statusCode).toBe(200);
    const events = eventsResponse.json<{
      webhook_events: Array<{ id: string; provider: string; status: string }>;
    }>();
    const event = events.webhook_events.find(
      (candidate) => candidate.provider === "chatwoot" && candidate.status === "ignored"
    );
    expect(event).toBeDefined();

    const retryResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/projects/proj_demo/webhooks/events/${event?.id}/retry`,
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    expect(retryResponse.statusCode).toBe(200);
    const retry = retryResponse.json<{
      webhook_event: { status: string };
      job: { id: string; type: string; status: string };
    }>();
    expect(retry.webhook_event.status).toBe("received");
    expect(retry.job).toMatchObject({
      type: "webhook.retry",
      status: "queued"
    });

    const opsResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/projects/proj_demo/ops/health",
      headers: {
        authorization: "Bearer admin_demo_key"
      }
    });
    expect(opsResponse.statusCode).toBe(200);
    const ops = opsResponse.json<{
      status: string;
      checks: { chatwoot: { configured: boolean; status?: string } };
      counts: {
        recent_async_jobs: Record<string, number>;
        recent_webhook_events: Record<string, number>;
      };
    }>();
    expect(ops.status).toBe("ok");
    expect(ops.checks.chatwoot).toMatchObject({
      configured: true,
      status: "active"
    });
    expect(ops.counts.recent_async_jobs.queued).toBeGreaterThanOrEqual(1);
    expect(ops.counts.recent_webhook_events.received).toBeGreaterThanOrEqual(1);
  });

  it("tests Chatwoot integration connectivity", async () => {
    const chatwootFetch: typeof fetch = async (input) => {
      if (String(input).endsWith("/inboxes")) {
        return new Response(
          JSON.stringify({
            payload: [
              {
                id: 1,
                name: "Support"
              }
            ]
          }),
          { status: 200 }
        );
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
      await chatwootApp.inject({
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

      const testResponse = await chatwootApp.inject({
        method: "POST",
        url: "/v1/admin/projects/proj_demo/integrations/chatwoot/test",
        headers: {
          authorization: "Bearer admin_demo_key"
        }
      });

      expect(testResponse.statusCode).toBe(200);
      const payload = testResponse.json<{
        ok: boolean;
        result: { inboxName?: string };
        integration: { metadata: Record<string, unknown> };
      }>();
      expect(payload.ok).toBe(true);
      expect(payload.result.inboxName).toBe("Support");
      expect(payload.integration.metadata["last_test_ok"]).toBe(true);
      expect(payload.integration.metadata["last_test_inbox_name"]).toBe("Support");
    } finally {
      await chatwootApp.close();
    }
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

      const statusResponse = await chatwootApp.inject({
        method: "POST",
        url: "/v1/webhooks/chatwoot/proj_demo",
        headers: {
          "x-opensupportai-signature": "chatwoot_secret"
        },
        payload: {
          id: "cw_status_1",
          event: "conversation_status_changed",
          status: "resolved",
          conversation: {
            id: 91
          }
        }
      });
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json<{ conversation_status: string }>().conversation_status).toBe(
        "closed"
      );

      const closedAdminResponse = await chatwootApp.inject({
        method: "GET",
        url: `/v1/admin/projects/proj_demo/conversations/${conversation.conversation_id}`,
        headers: {
          authorization: "Bearer admin_demo_key"
        }
      });
      const closedAdmin = closedAdminResponse.json<{
        conversation: { status: string };
        handoff_sessions: Array<{ status: string; externalConversationId?: string }>;
      }>();
      expect(closedAdmin.conversation.status).toBe("closed");
      expect(closedAdmin.handoff_sessions[0]).toMatchObject({
        status: "closed",
        externalConversationId: "91"
      });
    } finally {
      await chatwootApp.close();
    }
  });

  it("retries failed Chatwoot handoff sessions", async () => {
    let failFirstTranscriptPush = true;
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
        if (failFirstTranscriptPush) {
          failFirstTranscriptPush = false;
          return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
        }
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
      await chatwootApp.inject({
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
            external_user_id: "user_retry"
          }
        }
      });
      const conversation = conversationResponse.json<{ conversation_id: string }>();

      const failedHandoffResponse = await chatwootApp.inject({
        method: "POST",
        url: `/v1/client/conversations/${conversation.conversation_id}/handoff`,
        headers: {
          "x-opensupportai-public-key": "pk_demo"
        },
        payload: {
          reason: "user_requested"
        }
      });
      expect(failedHandoffResponse.statusCode).toBe(200);
      expect(failedHandoffResponse.json<{ status: string }>().status).toBe("handoff_requested");

      const failedAdminResponse = await chatwootApp.inject({
        method: "GET",
        url: `/v1/admin/projects/proj_demo/conversations/${conversation.conversation_id}`,
        headers: {
          authorization: "Bearer admin_demo_key"
        }
      });
      const failedAdmin = failedAdminResponse.json<{
        handoff_sessions: Array<{
          id: string;
          status: string;
          externalConversationId?: string;
        }>;
      }>();
      expect(failedAdmin.handoff_sessions[0]).toMatchObject({
        status: "failed",
        externalConversationId: "91"
      });

      const retryResponse = await chatwootApp.inject({
        method: "POST",
        url: `/v1/admin/projects/proj_demo/handoffs/${failedAdmin.handoff_sessions[0]?.id}/retry`,
        headers: {
          authorization: "Bearer admin_demo_key"
        }
      });
      expect(retryResponse.statusCode).toBe(200);
      expect(retryResponse.json<{ status: string }>().status).toBe("handed_off");

      const retriedAdminResponse = await chatwootApp.inject({
        method: "GET",
        url: `/v1/admin/projects/proj_demo/conversations/${conversation.conversation_id}`,
        headers: {
          authorization: "Bearer admin_demo_key"
        }
      });
      const retriedAdmin = retriedAdminResponse.json<{
        conversation: { status: string };
        handoff_sessions: Array<{ status: string; metadata: Record<string, unknown> }>;
      }>();
      expect(retriedAdmin.conversation.status).toBe("handed_off");
      expect(retriedAdmin.handoff_sessions[0]?.status).toBe("active");
      expect(retriedAdmin.handoff_sessions[0]?.metadata["retry_count"]).toBe(1);
      expect(chatwootCalls.filter((call) => call.url.endsWith("/conversations")).length).toBe(1);
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
