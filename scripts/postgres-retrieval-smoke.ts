import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../services/api/src/prisma-client";
import { PrismaSupportRepository } from "../services/api/src/repositories/prisma";

const prisma = createPrismaClient();
const repository = new PrismaSupportRepository(prisma);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const createdProjectIds: string[] = [];

try {
  const projectA = await repository.createProject({ name: `Lexical smoke A ${suffix}` });
  const projectB = await repository.createProject({ name: `Lexical smoke B ${suffix}` });
  createdProjectIds.push(projectA.id, projectB.id);

  const refundDocument = await repository.createKnowledgeDocument(projectA.id, {
    title: "Refund timing",
    sourceType: "text",
    content: "退款通常会在五个工作日内到账，具体时间取决于支付渠道。"
  });
  await repository.createKnowledgeDocument(projectA.id, {
    title: "API key rotation",
    sourceType: "text",
    content: "Rotate API keys from the security settings page and revoke the previous key."
  });
  const subscriptionDocument = await repository.createKnowledgeDocument(projectA.id, {
    title: "Subscription cancellation",
    sourceType: "text",
    content: "Cancel your subscription from the billing settings page."
  });
  await repository.createKnowledgeDocument(projectB.id, {
    title: "Tenant B only",
    sourceType: "text",
    content: `TENANT-B-OMEGA-${suffix} is visible only inside the second project.`
  });
  const pending = await prisma.knowledgeDocument.create({
    data: {
      id: `doc_pending_${suffix}`,
      projectId: projectA.id,
      title: "Pending content",
      sourceType: "text",
      content: `PENDING-NEBULA-${suffix}`,
      status: "pending",
      chunks: {
        create: {
          id: `chunk_pending_${suffix}`,
          projectId: projectA.id,
          chunkIndex: 0,
          content: `PENDING-NEBULA-${suffix}`,
          metadata: {}
        }
      }
    }
  });

  const refund = await repository.retrieveKnowledge(projectA.id, "退款多久到账？", 6);
  if (refund[0]?.documentId !== refundDocument.id || (refund[0]?.score ?? 0) < 0.34) {
    throw new Error("PostgreSQL lexical smoke did not rank the Chinese refund answer first");
  }

  const apiKey = await repository.retrieveKnowledge(projectA.id, "How do I rotate API keys?", 6);
  if (!apiKey[0]?.content.includes("Rotate API keys")) {
    throw new Error("PostgreSQL lexical smoke did not retrieve the English answer");
  }

  const fuzzyEnglish = await repository.retrieveKnowledge(projectA.id, "subscrption", 6);
  if (fuzzyEnglish[0]?.documentId !== subscriptionDocument.id) {
    throw new Error("PostgreSQL lexical smoke did not use the trigram fallback");
  }

  const crossProject = await repository.retrieveKnowledge(
    projectA.id,
    `TENANT-B-OMEGA-${suffix}`,
    6
  );
  if (crossProject.length !== 0) {
    throw new Error("PostgreSQL lexical smoke crossed a project boundary");
  }

  const pendingResult = await repository.retrieveKnowledge(projectA.id, pending.content, 6);
  if (pendingResult.length !== 0) {
    throw new Error("PostgreSQL lexical smoke returned a non-indexed document");
  }

  const noHit = await repository.retrieveKnowledge(projectA.id, "quantum nebula warranty", 6);
  if (noHit.length !== 0) {
    throw new Error("PostgreSQL lexical smoke returned an unrelated chunk");
  }

  const databaseEvidence = await prisma.$queryRaw<
    Array<{ extension_ready: boolean; index_count: bigint; populated_chunks: bigint }>
  >`
    SELECT
      EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS "extension_ready",
      (
        SELECT count(*)
        FROM pg_indexes
        WHERE indexname IN (
          'knowledge_chunks_search_text_fts_idx',
          'knowledge_chunks_content_trgm_idx'
        )
      ) AS "index_count",
      (
        SELECT count(*)
        FROM knowledge_chunks
        WHERE project_id = ${projectA.id} AND search_text <> ''
      ) AS "populated_chunks"
  `;
  const evidence = databaseEvidence[0];
  if (!evidence?.extension_ready || evidence.index_count !== 2n || evidence.populated_chunks < 3n) {
    throw new Error("PostgreSQL lexical smoke did not find the expected extension/index evidence");
  }

  process.stdout.write(
    `PostgreSQL lexical retrieval smoke passed: chinese=${refund[0].score}, english=${apiKey[0]?.score}, fuzzy=${fuzzyEnglish[0]?.score}, no_hit=${noHit.length}.\n`
  );
} finally {
  if (createdProjectIds.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  }
  await prisma.$disconnect();
}
