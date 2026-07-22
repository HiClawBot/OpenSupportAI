import { randomUUID } from "node:crypto";
import type { EvaluationObservation } from "@opensupportai/evals";
import {
  createEvolutionProposal,
  recordEvaluationRun,
  transitionEvolutionProposal
} from "../services/api/src/evolution";
import { createPrismaClient } from "../services/api/src/prisma-client";
import { PrismaSupportRepository } from "../services/api/src/repositories/prisma";

const prisma = createPrismaClient();
const repository = new PrismaSupportRepository(prisma);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
let suiteId: string | undefined;

try {
  const project = await repository.findProjectById("proj_demo");
  if (!project) {
    throw new Error("PostgreSQL evolution smoke requires the seeded proj_demo project");
  }
  const suite = await repository.createEvaluationSuite({
    projectId: project.id,
    slug: `postgres-evolution-smoke-${suffix}`,
    version: 1,
    name: "PostgreSQL evolution smoke",
    status: "active",
    evaluatorVersion: "osa-deterministic-v1",
    thresholds: {
      minScore: 100,
      minPassRate: 1,
      requireCriticalPass: true
    },
    createdBy: "system:postgres-evolution-smoke",
    scenarios: [
      {
        slug: "safe-refusal",
        category: "ambiguity",
        critical: true,
        input: { text: "Unknown question" },
        expectations: {
          outcome: "no_hit",
          conversationStatus: "open",
          aiRunStatus: "skipped",
          requiredAnswerMetadata: { no_hit: true }
        },
        orderIndex: 0
      }
    ]
  });
  suiteId = suite.id;

  const sourceRun = await recordEvaluationRun({
    repository,
    projectId: project.id,
    suiteId: suite.id,
    createdBy: "system:postgres-evolution-smoke",
    observations: [
      {
        scenarioSlug: "safe-refusal",
        observation: groundedObservation()
      }
    ]
  });
  if (sourceRun.status !== "failed") {
    throw new Error("PostgreSQL evolution smoke expected the source run to fail");
  }

  const proposal = await createEvolutionProposal({
    repository,
    projectId: project.id,
    sourceRunId: sourceRun.id,
    kind: "knowledge",
    title: "PostgreSQL smoke proposal",
    rationale: "Exercise persisted governance state transitions.",
    artifact: {
      operation: "draft_patch",
      content: "Refuse unsupported answers."
    },
    createdBy: "system:postgres-evolution-smoke"
  });
  const approved = await transitionEvolutionProposal({
    repository,
    projectId: project.id,
    proposalId: proposal.id,
    actor: "system:postgres-evolution-smoke",
    transition: { action: "approve" }
  });
  if (approved.status !== "approved") {
    throw new Error("PostgreSQL evolution smoke failed to approve the proposal");
  }

  const regressionRun = await recordEvaluationRun({
    repository,
    projectId: project.id,
    suiteId: suite.id,
    createdBy: "system:postgres-evolution-smoke",
    observations: [
      {
        scenarioSlug: "safe-refusal",
        observation: noHitObservation()
      }
    ]
  });
  const regression = await transitionEvolutionProposal({
    repository,
    projectId: project.id,
    proposalId: proposal.id,
    actor: "system:postgres-evolution-smoke",
    transition: {
      action: "record_regression",
      regressionRunId: regressionRun.id
    }
  });
  const canary = await transitionEvolutionProposal({
    repository,
    projectId: project.id,
    proposalId: proposal.id,
    actor: "system:postgres-evolution-smoke",
    transition: {
      action: "start_canary",
      canaryEvidence: {
        deployment_ref: `smoke/${suffix}`,
        scope: "isolated-smoke"
      },
      rollbackTarget: { deployment_ref: `smoke/${suffix}-baseline` }
    }
  });
  const promoted = await transitionEvolutionProposal({
    repository,
    projectId: project.id,
    proposalId: proposal.id,
    actor: "system:postgres-evolution-smoke",
    transition: {
      action: "promote",
      canaryEvidence: { outcome: "passed", observed_cases: 1 }
    }
  });
  const rolledBack = await transitionEvolutionProposal({
    repository,
    projectId: project.id,
    proposalId: proposal.id,
    actor: "system:postgres-evolution-smoke",
    transition: {
      action: "rollback",
      rollbackEvidence: { restored: true, reason: "smoke rehearsal" }
    }
  });

  if (
    regression.status !== "regression_passed" ||
    canary.status !== "canary" ||
    promoted.status !== "promoted" ||
    rolledBack.status !== "rolled_back"
  ) {
    throw new Error("PostgreSQL evolution smoke did not complete the governance state machine");
  }
  process.stdout.write(
    `PostgreSQL evolution smoke passed: source=${sourceRun.status}, regression=${regressionRun.status}, final=${rolledBack.status}.\n`
  );
} finally {
  if (suiteId) {
    const runIds = (
      await prisma.evaluationRun.findMany({ where: { suiteId }, select: { id: true } })
    ).map((run) => run.id);
    await prisma.$transaction([
      prisma.evolutionProposal.deleteMany({
        where: {
          OR: [{ sourceRunId: { in: runIds } }, { regressionRunId: { in: runIds } }]
        }
      }),
      prisma.evaluationResult.deleteMany({ where: { runId: { in: runIds } } }),
      prisma.evaluationRun.deleteMany({ where: { id: { in: runIds } } }),
      prisma.evaluationScenario.deleteMany({ where: { suiteId } }),
      prisma.evaluationSuite.deleteMany({ where: { id: suiteId } })
    ]);
  }
  await prisma.$disconnect();
}

function groundedObservation(): EvaluationObservation {
  return {
    conversationStatus: "open",
    answer: {
      text: "Unsupported grounded answer",
      metadata: { grounded: true },
      sourceRefs: [{ documentId: "doc_wrong" }]
    },
    aiRun: { status: "completed", metadata: {} },
    toolCalls: [],
    handoffSessions: 0
  };
}

function noHitObservation(): EvaluationObservation {
  return {
    conversationStatus: "open",
    answer: {
      text: "I cannot confirm from the current knowledge base.",
      metadata: { no_hit: true },
      sourceRefs: []
    },
    aiRun: { status: "skipped", metadata: {} },
    toolCalls: [],
    handoffSessions: 0
  };
}
