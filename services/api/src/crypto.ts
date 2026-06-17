import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function encryptJson(value: Record<string, unknown>, secret: string): string {
  const iv = randomBytes(12);
  const key = keyFromSecret(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString(
    "base64url"
  )}`;
}

export function decryptJson(value: string, secret: string): Record<string, unknown> {
  const [version, ivPart, tagPart, encryptedPart] = value.split(".");

  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) {
    throw new Error("Unsupported encrypted payload format");
  }

  const key = keyFromSecret(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final()
  ]);
  const parsed: unknown = JSON.parse(plaintext.toString("utf8"));

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Encrypted payload is not a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}
