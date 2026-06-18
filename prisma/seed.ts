import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const organization = await prisma.organization.upsert({
    where: { id: "org_demo" },
    update: { name: "Demo Organization" },
    create: {
      id: "org_demo",
      name: "Demo Organization"
    }
  });

  const project = await prisma.project.upsert({
    where: { id: "proj_demo" },
    update: {
      name: "Demo Project",
      publicKey: "pk_demo"
    },
    create: {
      id: "proj_demo",
      organizationId: organization.id,
      name: "Demo Project",
      publicKey: "pk_demo",
      defaultLocale: "zh-CN"
    }
  });

  await prisma.inbox.upsert({
    where: { id: "inbox_default" },
    update: {
      name: "Default Inbox",
      handoffProvider: "chatwoot"
    },
    create: {
      id: "inbox_default",
      projectId: project.id,
      name: "Default Inbox",
      handoffProvider: "chatwoot"
    }
  });

  await prisma.apiKey.upsert({
    where: { keyHash: hashSecret("admin_demo_key") },
    update: {
      name: "Demo Admin Key",
      revokedAt: null,
      scopes: ["admin:*"]
    },
    create: {
      id: "key_demo_admin",
      organizationId: organization.id,
      projectId: project.id,
      name: "Demo Admin Key",
      keyHash: hashSecret("admin_demo_key"),
      scopes: ["admin:*"]
    }
  });

  await prisma.llmProvider.upsert({
    where: { id: "llm_demo" },
    update: {
      baseUrl: "demo://local",
      model: "demo-support-model",
      embeddingModel: "demo-embedding",
      apiKeyEncrypted: "demo-local-key",
      status: "active"
    },
    create: {
      id: "llm_demo",
      projectId: project.id,
      provider: "openai_compatible",
      baseUrl: "demo://local",
      model: "demo-support-model",
      embeddingModel: "demo-embedding",
      apiKeyEncrypted: "demo-local-key",
      status: "active",
      metadata: {
        demo: true
      }
    }
  });

  await seedDemoTools(project.id);

  const source = await prisma.knowledgeSource.upsert({
    where: { id: "ks_demo" },
    update: {
      name: "Demo FAQ",
      type: "manual"
    },
    create: {
      id: "ks_demo",
      projectId: project.id,
      type: "manual",
      name: "Demo FAQ",
      config: {}
    }
  });

  const demoKnowledgeContent = [
    "用户可以在账单设置页面取消订阅。取消订阅后，当前计费周期仍然可以继续使用；周期结束后不会再次扣费。",
    "退款问题需要人工审核。用户可以提供订单号和付款邮箱，客服会根据当前政策确认是否符合退款条件。"
  ].join("\n\n");
  const document = await prisma.knowledgeDocument.upsert({
    where: { id: "doc_demo_billing" },
    update: {
      title: "账单和订阅 FAQ",
      status: "indexed",
      content: demoKnowledgeContent,
      contentHash: hashSecret(demoKnowledgeContent),
      error: null
    },
    create: {
      id: "doc_demo_billing",
      projectId: project.id,
      sourceId: source.id,
      title: "账单和订阅 FAQ",
      sourceType: "markdown",
      content: demoKnowledgeContent,
      status: "indexed",
      contentHash: hashSecret(demoKnowledgeContent),
      metadata: {
        locale: "zh-CN",
        tags: ["billing", "subscription"],
        chunk_count: 2
      }
    }
  });

  await prisma.knowledgeChunk.deleteMany({
    where: {
      projectId: project.id,
      documentId: document.id
    }
  });

  await prisma.knowledgeChunk.createMany({
    data: [
      {
        id: "chunk_demo_cancel_subscription",
        projectId: project.id,
        documentId: document.id,
        chunkIndex: 0,
        content:
          "用户可以在账单设置页面取消订阅。取消订阅后，当前计费周期仍然可以继续使用；周期结束后不会再次扣费。",
        tokenCount: 52,
        metadata: {
          title: "取消订阅",
          source_uri: "demo://knowledge/billing"
        }
      },
      {
        id: "chunk_demo_refund",
        projectId: project.id,
        documentId: document.id,
        chunkIndex: 1,
        content:
          "退款问题需要人工审核。用户可以提供订单号和付款邮箱，客服会根据当前政策确认是否符合退款条件。",
        tokenCount: 46,
        metadata: {
          title: "退款审核",
          source_uri: "demo://knowledge/billing"
        }
      }
    ]
  });

  console.log("Seeded demo organization, project, inbox, admin key, LLM provider, and FAQ.");
  console.log("Demo project_id=proj_demo public_key=pk_demo admin_token=admin_demo_key");
}

async function seedDemoTools(projectId: string): Promise<void> {
  for (const tool of [
    {
      id: "tool_demo_order_lookup",
      slug: "demo.order_lookup",
      name: "Demo order lookup",
      description: "Looks up a demo billing order by order_id.",
      path: "demo://orders/{order_id}",
      inputSchema: {
        type: "object",
        required: ["order_id"],
        properties: {
          order_id: { type: "string" }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          found: { type: "boolean" },
          order_id: { type: "string" },
          status: { type: "string" }
        }
      }
    },
    {
      id: "tool_demo_subscription_lookup",
      slug: "demo.subscription_lookup",
      name: "Demo subscription lookup",
      description: "Looks up the demo user's subscription status by external_user_id.",
      path: "demo://subscriptions/{external_user_id}",
      inputSchema: {
        type: "object",
        required: ["external_user_id"],
        properties: {
          external_user_id: { type: "string" }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          found: { type: "boolean" },
          status: { type: "string" },
          plan: { type: "string" }
        }
      }
    }
  ]) {
    await prisma.toolDefinition.upsert({
      where: {
        projectId_slug: {
          projectId,
          slug: tool.slug
        }
      },
      update: {
        name: tool.name,
        description: tool.description,
        kind: "demo",
        status: "active",
        method: "GET",
        path: tool.path,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        metadata: {
          readonly: true,
          demo: true
        }
      },
      create: {
        id: tool.id,
        projectId,
        slug: tool.slug,
        name: tool.name,
        description: tool.description,
        kind: "demo",
        status: "active",
        method: "GET",
        path: tool.path,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        metadata: {
          readonly: true,
          demo: true
        }
      }
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
