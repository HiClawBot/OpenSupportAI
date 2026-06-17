import type { FastifyRequest } from "fastify";
import type { ApiConfig } from "./config";
import { forbidden, unauthorized } from "./errors";
import { hashSecret } from "./crypto";
import type { ProjectRecord, SupportRepository } from "./repositories/types";

export async function authenticateClient(
  request: FastifyRequest,
  repository: SupportRepository,
  expectedProjectId?: string
): Promise<ProjectRecord> {
  const publicKeyHeader = request.headers["x-opensupportai-public-key"];
  const publicKeyFromHeader = Array.isArray(publicKeyHeader) ? publicKeyHeader[0] : publicKeyHeader;
  const query = request.query as { public_key?: string };
  const publicKey = publicKeyFromHeader ?? query.public_key;

  if (!publicKey) {
    throw unauthorized("Missing X-OpenSupportAI-Public-Key header");
  }

  const project = await repository.findProjectByPublicKey(publicKey);
  if (!project) {
    throw unauthorized("Invalid project public key");
  }

  if (expectedProjectId && project.id !== expectedProjectId) {
    throw forbidden("Public key does not match requested project");
  }

  return project;
}

export async function authenticateAdmin(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig
): Promise<ProjectRecord | undefined> {
  const token = bearerToken(request);
  if (!token) {
    throw unauthorized("Missing admin bearer token");
  }

  if (token === config.adminToken) {
    return undefined;
  }

  const project = await repository.findProjectByAdminKeyHash(hashSecret(token));
  if (!project) {
    throw unauthorized("Invalid admin bearer token");
  }

  return project;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization.slice("Bearer ".length).trim();
}
