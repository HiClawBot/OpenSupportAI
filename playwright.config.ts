import { defineConfig, devices } from "@playwright/test";

const apiUrl = "http://127.0.0.1:4300";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 7_500
  },
  reporter: process.env["CI"] ? [["github"], ["line"]] : "line",
  use: {
    baseURL: "http://127.0.0.1:4311",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  outputDir: "output/playwright/test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] }
    }
  ],
  webServer: [
    {
      command:
        "OPENSUPPORTAI_STORAGE=memory RATE_LIMIT_ENABLED=false PORT=4300 pnpm --filter @opensupportai/api dev:demo",
      url: `${apiUrl}/health`,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000
    },
    {
      command:
        "VITE_API_URL=http://127.0.0.1:4300 pnpm --filter @opensupportai/admin-console exec vite --host 127.0.0.1 --port 4310",
      url: "http://127.0.0.1:4310",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000
    },
    {
      command:
        "VITE_API_URL=http://127.0.0.1:4300 pnpm --filter @opensupportai/demo-app exec vite --host 127.0.0.1 --port 4311",
      url: "http://127.0.0.1:4311",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000
    }
  ]
});
