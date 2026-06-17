import { describe, expect, it } from "vitest";
import { workerRuntimeConfig } from "./index";

describe("worker skeleton", () => {
  it("uses the default queue name", () => {
    expect(workerRuntimeConfig.queueName).toBe("opensupportai");
  });
});
