import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_EVALUATOR_VERSION,
  evaluateScenario,
  summarizeEvaluation,
  type EvaluationObservation,
  type EvaluationScenario
} from "./index";

const groundedObservation: EvaluationObservation = {
  conversationStatus: "open",
  answer: {
    text: "Use the billing settings page.",
    metadata: { grounded: true },
    sourceRefs: [{ documentId: "doc_1", chunkId: "chunk_1" }]
  },
  aiRun: { status: "completed", metadata: {} },
  toolCalls: [],
  handoffSessions: 0
};

const scenario: EvaluationScenario = {
  slug: "faq-grounded",
  category: "faq",
  critical: true,
  input: { text: "How do I cancel?" },
  expectations: {
    outcome: "grounded",
    conversationStatus: "open",
    aiRunStatus: "completed",
    minCitations: 1,
    requiredAnswerMetadata: { grounded: true }
  }
};

describe("deterministic evaluation", () => {
  it("passes an observation only when every scenario assertion passes", () => {
    const result = evaluateScenario(scenario, groundedObservation);

    expect(result).toMatchObject({ status: "passed", score: 100, outcome: "grounded" });
    expect(result.assertions.every((item) => item.passed)).toBe(true);
  });

  it("fails the suite when a critical scenario fails", () => {
    const result = evaluateScenario(scenario, {
      ...groundedObservation,
      answer: {
        text: "I do not know.",
        metadata: { no_hit: true },
        sourceRefs: []
      }
    });
    const summary = summarizeEvaluation([result], {
      minScore: 80,
      minPassRate: 0.8,
      requireCriticalPass: true
    });

    expect(summary).toMatchObject({
      evaluatorVersion: DETERMINISTIC_EVALUATOR_VERSION,
      status: "failed",
      criticalFailures: ["faq-grounded"]
    });
  });

  it("does not pass an empty suite", () => {
    expect(
      summarizeEvaluation([], {
        minScore: 80,
        minPassRate: 0.8,
        requireCriticalPass: true
      })
    ).toMatchObject({ status: "failed", score: 0, passRate: 0 });
  });
});
