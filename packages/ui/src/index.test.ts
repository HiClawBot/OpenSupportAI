import { describe, expect, it } from "vitest";
import { uiPackage } from "./index";

describe("ui package skeleton", () => {
  it("exposes package metadata", () => {
    expect(uiPackage.name).toBe("@opensupportai/ui");
  });
});
