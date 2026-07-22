import { expect, test } from "@playwright/test";

const storageKey = "opensupportai:proj_demo:conversation";

test("renders pure English copy and recovers from conversation bootstrap failure", async ({
  page
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  let failedOnce = false;
  await page.route("**/v1/client/conversations", async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  await page.goto("/?locale=en");
  await page.getByRole("button", { name: "Open support chat" }).click();

  await expect(page.getByRole("alert")).toContainText("Support could not be loaded.");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), storageKey))
    .toContain("conversationToken");

  const panelText = await page.locator(".osa-panel").innerText();
  expect(panelText).not.toMatch(/\p{Script=Han}/u);
  await expect(page.getByPlaceholder("Type your question")).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("replaces a rejected stored capability with a new conversation", async ({ page }) => {
  await page.addInitScript(
    ({ key }) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          conversationId: "conv_expired",
          conversationToken: "expired_conversation_capability"
        })
      );
    },
    { key: storageKey }
  );

  await page.goto("/?locale=en");
  await page.getByRole("button", { name: "Open support chat" }).click();
  await expect(page.getByRole("alert")).toContainText("This support session has expired.");
  await page.getByRole("button", { name: "Start new chat" }).click();

  await expect
    .poll(async () => {
      const stored = await page.evaluate((key) => sessionStorage.getItem(key), storageKey);
      return stored ? JSON.parse(stored).conversationId : undefined;
    })
    .not.toBe("conv_expired");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("reuses the message idempotency key after a failed response", async ({ page }) => {
  await page.goto("/?locale=en");
  await page.getByRole("button", { name: "Open support chat" }).click();
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), storageKey))
    .toContain("conversationToken");

  const idempotencyKeys: string[] = [];
  let failedOnce = false;
  await page.route("**/v1/client/conversations/*/messages", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    idempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (!failedOnce) {
      failedOnce = true;
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  await page.getByPlaceholder("Type your question").fill("How do I update billing details?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("Your message could not be sent.");
  await page.getByRole("button", { name: "Retry" }).click();

  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[0]).not.toBe("");
  expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("renders the complete Chinese control copy", async ({ page }) => {
  await page.goto("/?locale=zh-CN");
  await page.getByRole("button", { name: "打开客服对话" }).click();

  await expect(page.getByText("客户支持", { exact: true })).toBeVisible();
  await expect(page.getByText("有什么可以帮你？", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "人工客服" })).toBeVisible();
  await expect(page.getByPlaceholder("输入问题")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭客服对话" })).toHaveCount(2);

  const panelBox = await page.locator(".osa-panel").boundingBox();
  const viewport = page.viewportSize();
  expect(panelBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.y).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport!.height);
});
