import { describe, expect, it } from "vitest";
import { lexicalQueryTerms, MIN_LEXICAL_RELEVANCE, scoreChunk, tokenize } from "./knowledge-text";

describe("lexical knowledge matching", () => {
  it("removes question framing and keeps meaningful Chinese anchors", () => {
    expect(lexicalQueryTerms("怎么取消订阅？")).toContain("取消订阅");
    expect(lexicalQueryTerms("退款多久到账？")).toContain("退款");
    expect(lexicalQueryTerms("这个为什么不行？")).toEqual(["不行"]);
  });

  it("drops common English framing terms", () => {
    expect(lexicalQueryTerms("How can I cancel my subscription please?")).toEqual([
      "subscription",
      "cancel"
    ]);
  });

  it("passes a domain anchor and rejects unrelated content", () => {
    const terms = tokenize("如何申请退款");
    expect(
      scoreChunk("退款问题需要人工审核，客服会根据当前政策确认退款条件。", terms)
    ).toBeGreaterThanOrEqual(MIN_LEXICAL_RELEVANCE);
    expect(scoreChunk("用户可以在安全设置中修改登录邮箱。", terms)).toBe(0);
  });
});
