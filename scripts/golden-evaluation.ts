import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DETERMINISTIC_EVALUATOR_VERSION,
  evaluateScenario,
  summarizeEvaluation,
  type EvaluationObservation,
  type EvaluationScenario,
  type EvaluationThresholds
} from "@opensupportai/evals";
import { EventHub } from "../services/api/src/event-hub";
import { createOrchestrator } from "../services/api/src/orchestrator";
import { MemorySupportRepository } from "../services/api/src/repositories/memory";

type GoldenCorpus = {
  schema_version: "1";
  suite: {
    slug: string;
    version: number;
    name: string;
    evaluator_version: string;
    thresholds: EvaluationThresholds;
  };
  scenarios: EvaluationScenario[];
};

const corpusPath = fileURLToPath(new URL("../evals/golden/beta-core.v1.json", import.meta.url));
const corpus = parseCorpus(JSON.parse(await readFile(corpusPath, "utf8")));
const results = [];

for (const scenario of corpus.scenarios) {
  const observation = await runScenario(scenario);
  const result = evaluateScenario(scenario, observation);
  results.push(result);
  process.stdout.write(
    `${result.status === "passed" ? "PASS" : "FAIL"} ${scenario.slug} (${result.score})\n`
  );
  for (const failed of result.assertions.filter((assertion) => !assertion.passed)) {
    process.stdout.write(
      `  ${failed.key}: expected=${JSON.stringify(failed.expected)} actual=${JSON.stringify(failed.actual)}\n`
    );
  }
}

const summary = summarizeEvaluation(results, corpus.suite.thresholds);
process.stdout.write(
  `${corpus.suite.slug}@${corpus.suite.version} ${summary.status}: score=${summary.score}, pass_rate=${summary.passRate.toFixed(3)}, passed=${summary.passedCount}, failed=${summary.failedCount}\n`
);

if (summary.status !== "passed") {
  process.exitCode = 1;
}

async function runScenario(scenario: EvaluationScenario): Promise<EvaluationObservation> {
  const repository = new MemorySupportRepository();
  await repository.seedDemo();
  const fixture = optionalString(scenario.input["fixture"]);
  if (fixture === "llm_failure") {
    await repository.upsertLlmProvider({
      projectId: "proj_demo",
      provider: "openai_compatible",
      baseUrl: "https://llm.example.test/v1",
      model: "golden-provider-failure",
      apiKeyEncrypted: "golden-secret",
      status: "active"
    });
  }
  if (fixture === "tool_failure") {
    await repository.upsertToolDefinition({
      projectId: "proj_demo",
      slug: "golden.shipment_lookup",
      name: "Shipment lookup",
      description: "Reads shipment status for the golden evaluation suite.",
      kind: "openapi",
      status: "active",
      method: "GET",
      path: "/shipments/{tracking_id}",
      inputSchema: {
        type: "object",
        required: ["tracking_id"]
      },
      metadata: {
        base_url: "https://tools.example.test",
        allowed_hosts: ["tools.example.test"],
        intent: {
          keywords: ["物流状态"],
          extract: {
            field: "tracking_id",
            pattern: "(SHIP-[0-9]+)"
          }
        }
      }
    });
  }

  const inbox = await repository.findInbox("proj_demo", "inbox_default");
  const externalUserId = optionalString(scenario.input["external_user_id"]);
  const contact = await repository.upsertContact("proj_demo", {
    ...(externalUserId ? { externalUserId } : {})
  });
  const conversation = await repository.createConversation({
    projectId: "proj_demo",
    inboxId: inbox?.id ?? "inbox_default",
    contactId: contact.id,
    metadata: {
      evaluation_scenario: scenario.slug
    }
  });
  const message = await repository.createMessage({
    projectId: "proj_demo",
    conversationId: conversation.id,
    message: {
      role: "end_user",
      text: requiredString(scenario.input["text"], `${scenario.slug}.input.text`)
    }
  });
  const orchestrator = createOrchestrator(repository, new EventHub(), {
    generateGroundedAnswer:
      fixture === "llm_failure"
        ? async () => {
            throw new Error("Golden LLM provider outage");
          }
        : undefined,
    businessToolFetch:
      fixture === "tool_failure"
        ? async () => new Response("upstream unavailable", { status: 503 })
        : undefined
  });
  const answer = await orchestrator.respondToUserMessage({
    projectId: "proj_demo",
    conversationId: conversation.id,
    message
  });
  const updatedConversation = await repository.findConversation("proj_demo", conversation.id);
  const aiRun = (await repository.listAiRuns("proj_demo", conversation.id))[0];
  const toolCalls = await repository.listToolCalls({
    projectId: "proj_demo",
    conversationId: conversation.id
  });
  const handoffSessions = await repository.listHandoffSessions({
    projectId: "proj_demo",
    conversationId: conversation.id
  });

  return {
    conversationStatus: updatedConversation?.status ?? "missing",
    ...(answer
      ? {
          answer: {
            text: optionalString(answer.content["text"]) ?? "",
            metadata: answer.metadata,
            sourceRefs: answer.sourceRefs ?? []
          }
        }
      : {}),
    ...(aiRun
      ? {
          aiRun: {
            status: aiRun.status,
            metadata: aiRun.metadata
          }
        }
      : {}),
    toolCalls: toolCalls.map((toolCall) => ({
      status: toolCall.status,
      toolSlug: toolCall.toolSlug
    })),
    handoffSessions: handoffSessions.length
  };
}

function parseCorpus(value: unknown): GoldenCorpus {
  if (!isRecord(value) || value["schema_version"] !== "1") {
    throw new Error("Golden corpus schema_version must be 1");
  }
  const suite = value["suite"];
  const scenarios = value["scenarios"];
  if (!isRecord(suite) || !Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("Golden corpus requires a suite and at least one scenario");
  }
  if (suite["evaluator_version"] !== DETERMINISTIC_EVALUATOR_VERSION) {
    throw new Error(
      `Golden corpus evaluator mismatch: expected ${DETERMINISTIC_EVALUATOR_VERSION}`
    );
  }
  return value as GoldenCorpus;
}

function requiredString(value: unknown, path: string): string {
  const parsed = optionalString(value);
  if (!parsed) {
    throw new Error(`Golden corpus string is required: ${path}`);
  }
  return parsed;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
