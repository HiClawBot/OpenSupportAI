import { describe, expect, it } from "vitest";
import { health } from "./index";

describe("api service skeleton", () => {
  it("returns a health payload", () => {
    expect(health()).toEqual({
      status: "ok",
      service: "@opensupportai/api"
    });
  });
});
