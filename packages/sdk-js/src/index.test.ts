import { describe, expect, it } from "vitest";
import { OpenSupportAIClient } from "./index";

describe("sdk client skeleton", () => {
  it("stores client options", () => {
    const client = new OpenSupportAIClient({
      apiUrl: "http://localhost:4000",
      projectId: "proj_demo",
      publicKey: "pk_demo"
    });

    expect(client.options.projectId).toBe("proj_demo");
  });

  it("creates browser SSE URLs with the public key in query params", () => {
    const url = new URL("http://localhost:4000/v1/client/conversations/conv_123/events");
    url.searchParams.set("public_key", "pk_demo");

    expect(url.toString()).toBe(
      "http://localhost:4000/v1/client/conversations/conv_123/events?public_key=pk_demo"
    );
  });
});
