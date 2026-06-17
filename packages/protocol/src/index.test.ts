import { describe, expect, it } from "vitest";
import { createApiRequestId } from "./api";

describe("protocol helpers", () => {
  it("creates request ids with the expected prefix", () => {
    expect(createApiRequestId("test")).toMatch(/^test_[0-9a-f-]{36}$/);
  });
});
