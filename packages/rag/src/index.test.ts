import { describe, expect, it } from "vitest";
import { createNoHitResult, indexTextDocument, retrieveByKeyword } from "./index";

describe("rag package skeleton", () => {
  it("represents no-hit retrieval without fabricated chunks", () => {
    expect(createNoHitResult()).toEqual({
      chunks: [],
      confidence: 0
    });
  });

  it("indexes and retrieves project-scoped chunks", () => {
    const chunks = indexTextDocument({
      projectId: "proj_demo",
      documentId: "doc_1",
      content: "用户可以在账单设置页面取消订阅。"
    });
    const result = retrieveByKeyword("proj_demo", "怎么取消订阅", chunks);

    expect(result.confidence).toBeGreaterThan(0);
    expect(result.chunks[0]?.content).toContain("取消订阅");
  });

  it("does not retrieve chunks across projects", () => {
    const chunks = indexTextDocument({
      projectId: "proj_a",
      documentId: "doc_1",
      content: "退款需要人工审核。"
    });

    expect(retrieveByKeyword("proj_b", "退款", chunks)).toEqual(createNoHitResult());
  });
});
