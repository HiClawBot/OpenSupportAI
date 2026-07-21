import type { FastifyRequest } from "fastify";
import type { ApiConfig } from "./config";
import { forbidden, unauthorized } from "./errors";
import { hashSecret } from "./crypto";
import { verifyClientToken, type ClientTokenClaims } from "./client-tokens";
import type { ConversationRecord, ProjectRecord, SupportRepository } from "./repositories/types";

export type AdminIdentity = {
  actorType: "root_admin" | "api_key";
  actorId?: string;
  project?: ProjectRecord;
  scopes: string[];
};

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

export async function authenticateConversation(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig,
  expectedConversationId: string
): Promise<{
  project: ProjectRecord;
  conversation: ConversationRecord;
  claims: ClientTokenClaims;
}> {
  const token = bearerToken(request);
  if (!token) {
    throw unauthorized("Missing conversation bearer token");
  }

  let claims: ClientTokenClaims;
  try {
    claims = verifyClientToken({
      token,
      secret: config.clientTokenSecret,
      purpose: "conversation"
    });
  } catch {
    throw unauthorized("Invalid or expired conversation token");
  }
  return resolveConversationClaims(repository, claims, expectedConversationId);
}

export async function authenticateStream(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig,
  expectedConversationId: string
): Promise<{
  project: ProjectRecord;
  conversation: ConversationRecord;
  claims: ClientTokenClaims;
}> {
  const query = request.query as { stream_token?: string };
  if (!query.stream_token) {
    throw unauthorized("Missing stream token");
  }

  let claims: ClientTokenClaims;
  try {
    claims = verifyClientToken({
      token: query.stream_token,
      secret: config.clientTokenSecret,
      purpose: "stream"
    });
  } catch {
    throw unauthorized("Invalid or expired stream token");
  }
  return resolveConversationClaims(repository, claims, expectedConversationId);
}

export async function authenticateAdmin(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig
): Promise<ProjectRecord | undefined> {
  return (await authenticateAdminIdentity(request, repository, config)).project;
}

export async function authenticateAdminIdentity(
  request: FastifyRequest,
  repository: SupportRepository,
  config: ApiConfig
): Promise<AdminIdentity> {
  const token = bearerToken(request);
  if (!token) {
    throw unauthorized("Missing admin bearer token");
  }

  if (token === config.adminToken) {
    return {
      actorType: "root_admin",
      scopes: ["admin:*"]
    };
  }

  const lookup = await repository.findAdminApiKeyByHash(hashSecret(token));
  if (!lookup?.project) {
    throw unauthorized("Invalid admin bearer token");
  }

  await repository.touchApiKeyLastUsed(lookup.apiKey.id);
  return {
    actorType: "api_key",
    actorId: lookup.apiKey.id,
    project: lookup.project,
    scopes: lookup.apiKey.scopes
  };
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization.slice("Bearer ".length).trim();
}

async function resolveConversationClaims(
  repository: SupportRepository,
  claims: ClientTokenClaims,
  expectedConversationId: string
): Promise<{
  project: ProjectRecord;
  conversation: ConversationRecord;
  claims: ClientTokenClaims;
}> {
  if (claims.conversationId !== expectedConversationId) {
    throw forbidden("Conversation token does not match requested conversation");
  }
  const project = await repository.findProjectById(claims.projectId);
  if (!project) {
    throw unauthorized("Conversation token project no longer exists");
  }
  const conversation = await repository.findConversation(project.id, claims.conversationId);
  if (!conversation) {
    throw unauthorized("Conversation token conversation no longer exists");
  }
  return { project, conversation, claims };
}
