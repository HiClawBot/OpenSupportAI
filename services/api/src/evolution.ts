import { createHash } from "node:crypto";
import {
  DETERMINISTIC_EVALUATOR_VERSION,
  evaluateScenario,
  summarizeEvaluation,
  type EvaluationExpectations,
  type EvaluationObservation,
  type EvaluationScenario
} from "@opensupportai/evals";
import { conflict, invalidRequest, notFound } from "./errors";
import type {
  EvaluationRunRecord,
  EvolutionProposalRecord,
  JsonRecord,
  SupportRepository
} from "./repositories/types";

export type EvaluationObservationInput = {
  scenarioSlug: string;
  observation: EvaluationObservation;
};

export type EvolutionProposalTransition =
  | { action: "approve"; reviewNote?: string }
  | { action: "reject"; reviewNote: string }
  | { action: "record_regression"; regressionRunId: string; reviewNote?: string }
  | {
      action: "start_canary";
      canaryEvidence: JsonRecord;
      rollbackTarget: JsonRecord;
      reviewNote?: string;
    }
  | { action: "promote"; canaryEvidence: JsonRecord; reviewNote?: string }
  | {
      action: "rollback";
      rollbackEvidence: JsonRecord;
      rollbackTarget?: JsonRecord;
      reviewNote?: string;
    };

export async function recordEvaluationRun(input: {
  repository: SupportRepository;
  projectId: string;
  suiteId: string;
  observations: EvaluationObservationInput[];
  createdBy: string;
  now?: () => Date;
}): Promise<EvaluationRunRecord> {
  const suite = await input.repository.findEvaluationSuite({
    projectId: input.projectId,
    id: input.suiteId
  });
  if (!suite) {
    throw notFound("Evaluation suite not found");
  }
  if (suite.status !== "active") {
    throw conflict("Only an active evaluation suite can be executed");
  }
  if (suite.evaluatorVersion !== DETERMINISTIC_EVALUATOR_VERSION) {
    throw conflict(
      `Unsupported evaluator version: ${suite.evaluatorVersion}; expected ${DETERMINISTIC_EVALUATOR_VERSION}`
    );
  }

  const observations = new Map<string, EvaluationObservation>();
  for (const item of input.observations) {
    if (observations.has(item.scenarioSlug)) {
      throw invalidRequest(`Duplicate scenario observation: ${item.scenarioSlug}`);
    }
    observations.set(item.scenarioSlug, item.observation);
  }
  const expectedSlugs = new Set(suite.scenarios.map((scenario) => scenario.slug));
  const missing = suite.scenarios
    .filter((scenario) => !observations.has(scenario.slug))
    .map((scenario) => scenario.slug);
  const extra = [...observations.keys()].filter((slug) => !expectedSlugs.has(slug));
  if (missing.length > 0 || extra.length > 0) {
    throw invalidRequest(
      `Evaluation observations must match the suite exactly; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`
    );
  }

  const results = suite.scenarios.map((scenario) =>
    evaluateScenario(
      {
        slug: scenario.slug,
        category: scenario.category,
        critical: scenario.critical,
        input: scenario.input,
        expectations: scenario.expectations as EvaluationExpectations,
        metadata: scenario.metadata
      } satisfies EvaluationScenario,
      observations.get(scenario.slug) as EvaluationObservation
    )
  );
  const summary = summarizeEvaluation(results, suite.thresholds);
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  return input.repository.createEvaluationRun({
    projectId: input.projectId,
    suite,
    createdBy: input.createdBy,
    startedAt: timestamp,
    completedAt: timestamp,
    summary
  });
}

export async function createEvolutionProposal(input: {
  repository: SupportRepository;
  projectId: string;
  sourceRunId: string;
  kind: "knowledge" | "prompt" | "tool";
  title: string;
  rationale: string;
  artifact: JsonRecord;
  baseline?: JsonRecord;
  createdBy: string;
}): Promise<EvolutionProposalRecord> {
  const sourceRun = await input.repository.findEvaluationRun({
    projectId: input.projectId,
    id: input.sourceRunId
  });
  if (!sourceRun) {
    throw notFound("Source evaluation run not found");
  }
  if (sourceRun.status !== "failed") {
    throw conflict("Evolution proposals require a failed source evaluation run");
  }
  if (Object.keys(input.artifact).length === 0) {
    throw invalidRequest("Evolution proposal artifact must not be empty");
  }
  return input.repository.createEvolutionProposal({
    projectId: input.projectId,
    sourceRunId: sourceRun.id,
    kind: input.kind,
    title: input.title,
    rationale: input.rationale,
    artifact: input.artifact,
    artifactHash: hashArtifact(input.artifact),
    baseline: {
      ...input.baseline,
      source_run_id: sourceRun.id,
      suite_id: sourceRun.suiteId,
      suite_version: sourceRun.suiteVersion,
      score: sourceRun.score,
      pass_rate: sourceRun.passRate
    },
    createdBy: input.createdBy
  });
}

export async function transitionEvolutionProposal(input: {
  repository: SupportRepository;
  projectId: string;
  proposalId: string;
  actor: string;
  transition: EvolutionProposalTransition;
  now?: () => Date;
}): Promise<EvolutionProposalRecord> {
  const proposal = await input.repository.findEvolutionProposal({
    projectId: input.projectId,
    id: input.proposalId
  });
  if (!proposal) {
    throw notFound("Evolution proposal not found");
  }
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const common = {
    projectId: input.projectId,
    id: proposal.id,
    expectedStatus: proposal.status
  };

  switch (input.transition.action) {
    case "approve":
      requireProposalStatus(proposal, ["draft"]);
      return input.repository.transitionEvolutionProposal({
        ...common,
        status: "approved",
        reviewedBy: input.actor,
        reviewedAt: timestamp,
        reviewNote: input.transition.reviewNote
      });
    case "reject":
      requireProposalStatus(proposal, ["draft", "approved"]);
      return input.repository.transitionEvolutionProposal({
        ...common,
        status: "rejected",
        reviewedBy: input.actor,
        reviewedAt: timestamp,
        reviewNote: input.transition.reviewNote
      });
    case "record_regression": {
      requireProposalStatus(proposal, ["approved"]);
      const regressionRun = await input.repository.findEvaluationRun({
        projectId: input.projectId,
        id: input.transition.regressionRunId
      });
      if (!regressionRun) {
        throw notFound("Regression evaluation run not found");
      }
      const sourceRun = await requiredSourceRun(input.repository, proposal);
      if (
        regressionRun.status !== "passed" ||
        regressionRun.id === sourceRun.id ||
        regressionRun.suiteId !== sourceRun.suiteId ||
        regressionRun.suiteVersion !== sourceRun.suiteVersion ||
        !proposal.reviewedAt ||
        new Date(regressionRun.createdAt).getTime() < new Date(proposal.reviewedAt).getTime()
      ) {
        throw conflict(
          "Regression evidence must be a new passing run of the same suite and version created after approval"
        );
      }
      return input.repository.transitionEvolutionProposal({
        ...common,
        status: "regression_passed",
        regressionRunId: regressionRun.id,
        reviewNote: input.transition.reviewNote
      });
    }
    case "start_canary":
      requireProposalStatus(proposal, ["regression_passed"]);
      requireEvidenceString(input.transition.canaryEvidence, "deployment_ref");
      requireEvidenceString(input.transition.canaryEvidence, "scope");
      return input.repository.transitionEvolutionProposal({
        ...common,
        status: "canary",
        canaryEvidence: input.transition.canaryEvidence,
        rollbackTarget: input.transition.rollbackTarget,
        reviewNote: input.transition.reviewNote
      });
    case "promote":
      requireProposalStatus(proposal, ["canary"]);
      if (input.transition.canaryEvidence["outcome"] !== "passed") {
        throw conflict("Promotion requires canary evidence with outcome=passed");
      }
      return input.repository.transitionEvolutionProposal({
        ...common,
        status: "promoted",
        canaryEvidence: {
          ...proposal.canaryEvidence,
          promotion_evidence: input.transition.canaryEvidence
        },
        reviewNote: input.transition.reviewNote,
        promotedAt: timestamp
      });
    case "rollback": {
      requireProposalStatus(proposal, ["canary", "promoted"]);
      const rollbackTarget = input.transition.rollbackTarget ?? proposal.rollbackTarget;
      if (!rollbackTarget || Object.keys(rollbackTarget).length === 0) {
        throw conflict("Rollback requires a recorded rollback target");
      }
      return input.repository.transitionEvolutionProposal({
        ...common,
        status: "rolled_back",
        canaryEvidence: {
          ...proposal.canaryEvidence,
          rollback_evidence: input.transition.rollbackEvidence
        },
        rollbackTarget,
        reviewNote: input.transition.reviewNote,
        rolledBackAt: timestamp
      });
    }
  }
}

export function hashArtifact(artifact: JsonRecord): string {
  return createHash("sha256").update(canonicalJson(artifact)).digest("hex");
}

function requireProposalStatus(
  proposal: EvolutionProposalRecord,
  allowed: EvolutionProposalRecord["status"][]
): void {
  if (!allowed.includes(proposal.status)) {
    throw conflict(
      `Evolution proposal action is not allowed from status ${proposal.status}; expected ${allowed.join(" or ")}`
    );
  }
}

async function requiredSourceRun(
  repository: SupportRepository,
  proposal: EvolutionProposalRecord
): Promise<EvaluationRunRecord> {
  const run = await repository.findEvaluationRun({
    projectId: proposal.projectId,
    id: proposal.sourceRunId
  });
  if (!run) {
    throw conflict("Evolution proposal source evaluation run no longer exists");
  }
  return run;
}

function requireEvidenceString(evidence: JsonRecord, key: string): void {
  const value = evidence[key];
  if (typeof value !== "string" || !value.trim()) {
    throw invalidRequest(`Canary evidence requires ${key}`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
