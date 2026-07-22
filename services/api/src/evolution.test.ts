import { describe, expect, it } from "vitest";
import { hashArtifact } from "./evolution";

describe("evolution evidence", () => {
  it("hashes semantically identical object keys deterministically", () => {
    const first = hashArtifact({
      operation: "draft_patch",
      target: { slug: "refund-policy", version: 2 },
      rules: [{ action: "clarify", priority: 1 }]
    });
    const reordered = hashArtifact({
      rules: [{ priority: 1, action: "clarify" }],
      target: { version: 2, slug: "refund-policy" },
      operation: "draft_patch"
    });

    expect(reordered).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves array order in the evidence hash", () => {
    expect(hashArtifact({ steps: ["review", "canary"] })).not.toBe(
      hashArtifact({ steps: ["canary", "review"] })
    );
  });
});
