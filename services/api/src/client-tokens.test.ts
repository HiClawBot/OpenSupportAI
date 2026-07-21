import { describe, expect, it } from "vitest";
import { issueClientToken, verifyClientToken } from "./client-tokens";

const secret = "test_client_token_secret_at_least_32_chars";
const now = new Date("2026-07-21T12:00:00.000Z");

describe("client capability tokens", () => {
  it("issues and verifies a conversation-scoped token", () => {
    const issued = issueClientToken({
      secret,
      purpose: "conversation",
      projectId: "proj_1",
      conversationId: "conv_1",
      ttlSeconds: 300,
      now
    });

    expect(
      verifyClientToken({ token: issued.token, secret, purpose: "conversation", now })
    ).toMatchObject({
      version: 1,
      purpose: "conversation",
      projectId: "proj_1",
      conversationId: "conv_1"
    });
    expect(issued.expiresAt).toBe("2026-07-21T12:05:00.000Z");
  });

  it("rejects the wrong purpose, secret, and expired tokens", () => {
    const issued = issueClientToken({
      secret,
      purpose: "conversation",
      projectId: "proj_1",
      conversationId: "conv_1",
      ttlSeconds: 60,
      now
    });

    expect(() =>
      verifyClientToken({ token: issued.token, secret, purpose: "stream", now })
    ).toThrow("purpose");
    expect(() =>
      verifyClientToken({
        token: issued.token,
        secret: `${secret}_wrong`,
        purpose: "conversation",
        now
      })
    ).toThrow("signature");
    expect(() =>
      verifyClientToken({
        token: issued.token,
        secret,
        purpose: "conversation",
        now: new Date("2026-07-21T12:01:00.000Z")
      })
    ).toThrow("expired");
  });
});
