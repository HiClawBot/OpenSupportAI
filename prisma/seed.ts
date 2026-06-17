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

  const document = await prisma.knowledgeDocument.upsert({
    where: { id: "doc_demo_billing" },
    update: {
      title: "账单和订阅 FAQ",
      status: "indexed"
    },
    create: {
      id: "doc_demo_billing",
      projectId: project.id,
      sourceId: source.id,
      title: "账单和订阅 FAQ",
      sourceType: "markdown",
      status: "indexed",
      metadata: {
        locale: "zh-CN",
        tags: ["billing", "subscription"]
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

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
