import { expect, test, type APIRequestContext } from "@playwright/test";

const apiUrl = "http://127.0.0.1:4300";
const projectPath = "/v1/admin/projects/proj_demo";
const headers = {
  Authorization: "Bearer admin_demo_key",
  "Content-Type": "application/json"
};

test("operator completes the governed proposal lifecycle", async ({ page }) => {
  const fixture = await createGovernanceFixture(page.request);
  await page.goto("http://127.0.0.1:4310/#governance");

  await expect(
    page.getByRole("heading", { name: "Evaluation and controlled evolution" })
  ).toBeVisible();
  const draftForm = page.locator("#governance form.panel.form").first();
  await draftForm.getByLabel("Source run").selectOption(fixture.sourceRunId);
  await draftForm.getByLabel("Title").fill(fixture.proposalTitle);
  await draftForm.getByLabel("Rationale").fill("Browser evidence for the controlled lifecycle.");
  await draftForm.getByRole("button", { name: "Create draft" }).click();

  await expect(page.getByText("Draft created; no production artifact was changed")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(fixture.proposalTitle) }).click();
  await page.getByRole("button", { name: "Approve for regression" }).click();
  await expect(page.locator('select[name="regression_run_id"]')).toBeVisible();

  const regressionRun = await createEvaluationRun(page.request, fixture.suiteId, {
    conversation_status: "open",
    answer: {
      text: "I cannot confirm from the current knowledge base.",
      metadata: { no_hit: true },
      source_refs: []
    },
    ai_run: { status: "skipped", metadata: {} },
    tool_calls: [],
    handoff_sessions: 0
  });
  await page.locator("#governance").getByRole("button", { name: "Refresh" }).click();
  await page.locator('select[name="regression_run_id"]').selectOption(regressionRun.run.id);
  await page.getByRole("button", { name: "Record regression" }).click();
  await expect(page.getByPlaceholder("Deployment reference")).toBeVisible();

  await page.getByPlaceholder("Deployment reference").fill("browser/revision-2");
  await page.getByPlaceholder("Canary scope").fill("browser-supervised");
  await page.getByPlaceholder("Rollback reference").fill("browser/revision-1");
  await page.getByRole("button", { name: "Start canary" }).click();
  await expect(page.getByPlaceholder("Observed cases")).toBeVisible();

  await page.getByPlaceholder("Observed cases").fill("3");
  await page.getByRole("button", { name: "Promote" }).click();
  const proposalRow = page.getByRole("button", { name: new RegExp(fixture.proposalTitle) });
  await expect(proposalRow).toContainText("promoted");
  await expect(page.getByRole("button", { name: "Record rollback" })).toBeEnabled();

  await page.getByPlaceholder("Rollback reason").fill("Browser recovery rehearsal");
  await page.getByRole("button", { name: "Record rollback" }).click();
  await expect(page.getByText("Proposal closed as rolled_back")).toBeVisible();
  await expect(proposalRow).toContainText("rolled_back");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
});

async function createGovernanceFixture(request: APIRequestContext): Promise<{
  suiteId: string;
  sourceRunId: string;
  proposalTitle: string;
}> {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const suitePayload = await post<{ suite: { id: string } }>(
    request,
    `${projectPath}/evaluations/suites`,
    {
      slug: `browser-governance-${suffix}`,
      version: 1,
      name: "Browser governance",
      evaluator_version: "osa-deterministic-v1",
      thresholds: {
        min_score: 100,
        min_pass_rate: 1,
        require_critical_pass: true
      },
      scenarios: [
        {
          slug: "safe-refusal",
          category: "ambiguity",
          critical: true,
          input: { text: "Unknown question" },
          expectations: {
            outcome: "no_hit",
            conversation_status: "open",
            ai_run_status: "skipped",
            required_answer_metadata: { no_hit: true }
          }
        }
      ]
    }
  );

  const sourceRun = await createEvaluationRun(request, suitePayload.suite.id, {
    conversation_status: "open",
    answer: {
      text: "Unsupported grounded answer",
      metadata: { grounded: true },
      source_refs: [{ documentId: "doc_wrong" }]
    },
    ai_run: { status: "completed", metadata: {} },
    tool_calls: [],
    handoff_sessions: 0
  });
  return {
    suiteId: suitePayload.suite.id,
    sourceRunId: sourceRun.run.id,
    proposalTitle: `Browser proposal ${suffix}`
  };
}

async function createEvaluationRun(
  request: APIRequestContext,
  suiteId: string,
  observation: Record<string, unknown>
): Promise<{ run: { id: string; status: string } }> {
  return post(request, `${projectPath}/evaluations/runs`, {
    suite_id: suiteId,
    observations: [{ scenario_slug: "safe-refusal", observation }]
  });
}

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${apiUrl}${path}`, { headers, data });
  const errorBody = response.ok() ? "" : await response.text();
  expect(response.ok(), `${path}: ${response.status()} ${errorBody}`).toBe(true);
  return response.json() as Promise<T>;
}
