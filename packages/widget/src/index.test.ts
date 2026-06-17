import { describe, expect, it } from "vitest";
import { init } from "./index";

describe("widget skeleton", () => {
  it("creates a widget controller", () => {
    const controller = init({
      apiUrl: "http://localhost:4000",
      projectId: "proj_demo",
      publicKey: "pk_demo"
    });

    expect(controller.client.options.apiUrl).toBe("http://localhost:4000");
  });
});
