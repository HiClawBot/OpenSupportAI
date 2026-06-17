export type ToolDefinitionStatus = "active" | "disabled";

export type ToolDefinitionKind = "demo" | "openapi";

export type ToolDefinition = {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  description: string;
  kind: ToolDefinitionKind;
  status: ToolDefinitionStatus;
  method?: string;
  path?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ToolCallStatus = "completed" | "failed" | "skipped";

export type ToolCall = {
  id: string;
  projectId: string;
  conversationId?: string;
  messageId?: string;
  toolId?: string;
  toolSlug: string;
  status: ToolCallStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  latencyMs?: number;
  createdAt: string;
};
