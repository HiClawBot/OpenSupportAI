import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const productionEnv = {
  NODE_ENV: "production",
  OPENSUPPORTAI_STORAGE: "prisma",
  DATABASE_URL: "postgresql://user:password@db.example.com:5432/opensupportai",
  ADMIN_API_TOKEN: "admin_token_with_at_least_32_characters",
  ENCRYPTION_KEY: "encryption_key_with_at_least_32_chars",
  CLIENT_TOKEN_SECRET: "client_token_secret_with_at_least_32_chars",
  CORS_ORIGIN: "https://support.example.com"
} satisfies NodeJS.ProcessEnv;

describe("API configuration", () => {
  it("keeps explicit development defaults for local evaluation", () => {
    const config = loadConfig({ NODE_ENV: "test" });

    expect(config.storageMode).toBe("memory");
    expect(config.allowPrivateOutbound).toBe(true);
    expect(config.streamTokenTtlSeconds).toBe(60);
  });

  it("accepts an explicit production configuration", () => {
    const config = loadConfig(productionEnv);

    expect(config.storageMode).toBe("prisma");
    expect(config.corsOrigin).toBe("https://support.example.com");
    expect(config.allowPrivateOutbound).toBe(false);
  });

  it("rejects production demo secrets, missing persistence, and wildcard CORS", () => {
    expect(() =>
      loadConfig({
        ...productionEnv,
        ADMIN_API_TOKEN: "admin_demo_key"
      })
    ).toThrow("ADMIN_API_TOKEN");
    expect(() =>
      loadConfig({
        ...productionEnv,
        ADMIN_API_TOKEN: "a".repeat(64)
      })
    ).toThrow("ADMIN_API_TOKEN");
    expect(() =>
      loadConfig({
        ...productionEnv,
        DATABASE_URL: ""
      })
    ).toThrow("DATABASE_URL");
    expect(() =>
      loadConfig({
        ...productionEnv,
        CORS_ORIGIN: "*"
      })
    ).toThrow("CORS_ORIGIN");
  });

  it("rejects stream credentials that live longer than five minutes", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        STREAM_TOKEN_TTL_SECONDS: "301"
      })
    ).toThrow("STREAM_TOKEN_TTL_SECONDS");
  });
});
