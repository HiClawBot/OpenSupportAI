import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type ClientTokenPurpose = "conversation" | "stream";

export type ClientTokenClaims = {
  version: 1;
  purpose: ClientTokenPurpose;
  projectId: string;
  conversationId: string;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
};

export function issueClientToken(input: {
  secret: string;
  purpose: ClientTokenPurpose;
  projectId: string;
  conversationId: string;
  ttlSeconds: number;
  now?: Date;
}): { token: string; expiresAt: string } {
  const now = input.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const claims: ClientTokenClaims = {
    version: 1,
    purpose: input.purpose,
    projectId: input.projectId,
    conversationId: input.conversationId,
    issuedAt,
    expiresAt: issuedAt + input.ttlSeconds,
    tokenId: randomUUID()
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(payload, input.secret);
  return {
    token: `osa_v1.${payload}.${signature}`,
    expiresAt: new Date(claims.expiresAt * 1000).toISOString()
  };
}

export function verifyClientToken(input: {
  token: string;
  secret: string;
  purpose: ClientTokenPurpose;
  now?: Date;
}): ClientTokenClaims {
  if (input.token.length > 4096) {
    throw new Error("Client token is too large");
  }
  const [prefix, payload, signature, extra] = input.token.split(".");
  if (prefix !== "osa_v1" || !payload || !signature || extra) {
    throw new Error("Invalid client token format");
  }
  const expected = Buffer.from(sign(payload, input.secret), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid client token signature");
  }

  const claims = parseClaims(payload);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (claims.purpose !== input.purpose) {
    throw new Error("Invalid client token purpose");
  }
  if (claims.issuedAt > now + 30 || claims.expiresAt <= now) {
    throw new Error("Client token is expired or not active");
  }
  return claims;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseClaims(payload: string): ClientTokenClaims {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid client token payload");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid client token claims");
  }
  const claims = parsed as Partial<ClientTokenClaims>;
  if (
    claims.version !== 1 ||
    (claims.purpose !== "conversation" && claims.purpose !== "stream") ||
    typeof claims.projectId !== "string" ||
    !claims.projectId ||
    typeof claims.conversationId !== "string" ||
    !claims.conversationId ||
    typeof claims.issuedAt !== "number" ||
    !Number.isInteger(claims.issuedAt) ||
    typeof claims.expiresAt !== "number" ||
    !Number.isInteger(claims.expiresAt) ||
    typeof claims.tokenId !== "string" ||
    !claims.tokenId
  ) {
    throw new Error("Invalid client token claims");
  }
  return claims as ClientTokenClaims;
}
