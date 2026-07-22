export const DETERMINISTIC_EVALUATOR_VERSION = "osa-deterministic-v1";

export type GoldenScenarioCategory =
  | "faq"
  | "ambiguity"
  | "prompt_injection"
  | "missing_identity"
  | "tool_failure"
  | "llm_failure"
  | "handoff";

export type EvaluationOutcome =
  | "grounded"
  | "no_hit"
  | "needs_identity"
  | "tool"
  | "degraded"
  | "handoff"
  | "unknown";

export type EvaluationScenario = {
  slug: string;
  category: GoldenScenarioCategory;
  critical?: boolean;
  input: Record<string, unknown>;
  expectations: EvaluationExpectations;
  metadata?: Record<string, unknown>;
};

export type EvaluationExpectations = {
  outcome: EvaluationOutcome;
  conversationStatus?: string;
  aiRunStatus?: string;
  minCitations?: number;
  minHandoffSessions?: number;
  toolCallStatus?: string;
  requiredAnswerMetadata?: Record<string, string | number | boolean>;
  answerIncludes?: string[];
  answerExcludes?: string[];
};

export type EvaluationObservation = {
  conversationStatus: string;
  answer?: {
    text: string;
    metadata: Record<string, unknown>;
    sourceRefs: Array<Record<string, unknown>>;
  };
  aiRun?: {
    status: string;
    metadata: Record<string, unknown>;
  };
  toolCalls: Array<{ status: string; toolSlug: string }>;
  handoffSessions: number;
};

export type EvaluationAssertion = {
  key: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

export type EvaluationScenarioResult = {
  scenarioSlug: string;
  category: GoldenScenarioCategory;
  critical: boolean;
  status: "passed" | "failed";
  score: number;
  outcome: EvaluationOutcome;
  assertions: EvaluationAssertion[];
  observation: EvaluationObservation;
};

export type EvaluationThresholds = {
  minScore: number;
  minPassRate: number;
  requireCriticalPass: boolean;
};

export type EvaluationSummary = {
  evaluatorVersion: typeof DETERMINISTIC_EVALUATOR_VERSION;
  status: "passed" | "failed";
  score: number;
  passRate: number;
  passedCount: number;
  failedCount: number;
  criticalFailures: string[];
  thresholds: EvaluationThresholds;
  results: EvaluationScenarioResult[];
};

export function evaluateScenario(
  scenario: EvaluationScenario,
  observation: EvaluationObservation
): EvaluationScenarioResult {
  const expected = scenario.expectations;
  const outcome = classifyOutcome(observation);
  const assertions: EvaluationAssertion[] = [assertion("outcome", expected.outcome, outcome)];

  if (expected.conversationStatus !== undefined) {
    assertions.push(
      assertion("conversation_status", expected.conversationStatus, observation.conversationStatus)
    );
  }
  if (expected.aiRunStatus !== undefined) {
    assertions.push(assertion("ai_run_status", expected.aiRunStatus, observation.aiRun?.status));
  }
  if (expected.minCitations !== undefined) {
    assertions.push(
      minimumAssertion(
        "citation_count",
        expected.minCitations,
        observation.answer?.sourceRefs.length ?? 0
      )
    );
  }
  if (expected.minHandoffSessions !== undefined) {
    assertions.push(
      minimumAssertion(
        "handoff_session_count",
        expected.minHandoffSessions,
        observation.handoffSessions
      )
    );
  }
  if (expected.toolCallStatus !== undefined) {
    assertions.push(
      assertion("tool_call_status", expected.toolCallStatus, observation.toolCalls.at(-1)?.status)
    );
  }
  for (const [key, value] of Object.entries(expected.requiredAnswerMetadata ?? {})) {
    assertions.push(assertion(`answer_metadata.${key}`, value, observation.answer?.metadata[key]));
  }
  for (const text of expected.answerIncludes ?? []) {
    assertions.push({
      key: `answer_includes:${text}`,
      passed: observation.answer?.text.includes(text) ?? false,
      expected: text,
      actual: observation.answer?.text
    });
  }
  for (const text of expected.answerExcludes ?? []) {
    assertions.push({
      key: `answer_excludes:${text}`,
      passed: !(observation.answer?.text.includes(text) ?? false),
      expected: `not:${text}`,
      actual: observation.answer?.text
    });
  }

  const passedCount = assertions.filter((item) => item.passed).length;
  const score = assertions.length === 0 ? 0 : Math.round((passedCount / assertions.length) * 100);
  return {
    scenarioSlug: scenario.slug,
    category: scenario.category,
    critical: scenario.critical ?? false,
    status: passedCount === assertions.length ? "passed" : "failed",
    score,
    outcome,
    assertions,
    observation
  };
}

export function summarizeEvaluation(
  results: EvaluationScenarioResult[],
  thresholds: EvaluationThresholds
): EvaluationSummary {
  const passedCount = results.filter((result) => result.status === "passed").length;
  const failedCount = results.length - passedCount;
  const score =
    results.length === 0
      ? 0
      : Math.round(results.reduce((total, result) => total + result.score, 0) / results.length);
  const passRate = results.length === 0 ? 0 : passedCount / results.length;
  const criticalFailures = results
    .filter((result) => result.critical && result.status === "failed")
    .map((result) => result.scenarioSlug);
  const passed =
    score >= thresholds.minScore &&
    passRate >= thresholds.minPassRate &&
    (!thresholds.requireCriticalPass || criticalFailures.length === 0);

  return {
    evaluatorVersion: DETERMINISTIC_EVALUATOR_VERSION,
    status: passed ? "passed" : "failed",
    score,
    passRate,
    passedCount,
    failedCount,
    criticalFailures,
    thresholds,
    results
  };
}

export function classifyOutcome(observation: EvaluationObservation): EvaluationOutcome {
  if (observation.handoffSessions > 0 || observation.aiRun?.status === "handoff") {
    return "handoff";
  }
  if (observation.answer?.metadata["needs_identity"] === true) {
    return "needs_identity";
  }
  if (observation.answer?.metadata["degraded"] === true) {
    return "degraded";
  }
  if (observation.answer?.metadata["tool_slug"] !== undefined) {
    return "tool";
  }
  if (observation.answer?.metadata["no_hit"] === true) {
    return "no_hit";
  }
  if (
    observation.answer?.metadata["grounded"] === true &&
    observation.answer.sourceRefs.length > 0
  ) {
    return "grounded";
  }
  return "unknown";
}

function assertion(key: string, expected: unknown, actual: unknown): EvaluationAssertion {
  return {
    key,
    passed: Object.is(expected, actual),
    expected,
    actual
  };
}

function minimumAssertion(key: string, expected: number, actual: number): EvaluationAssertion {
  return {
    key,
    passed: actual >= expected,
    expected: { minimum: expected },
    actual
  };
}
