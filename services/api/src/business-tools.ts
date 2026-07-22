import type {
  JsonRecord,
  SupportRepository,
  ToolCallRecord,
  ToolDefinitionRecord
} from "./repositories/types";

export type BusinessToolResult = {
  answer: string;
  tool: ToolDefinitionRecord;
  toolCall: ToolCallRecord;
};

export type BusinessToolOptions = {
  fetchImpl?: typeof fetch;
  allowMutations?: boolean;
};

type DemoToolIntent =
  | {
      slug: "demo.order_lookup";
      input: { order_id: string };
    }
  | {
      slug: "demo.subscription_lookup";
      input: { external_user_id: string };
    };

type OpenApiToolIntent = {
  slug: string;
  input: JsonRecord;
  kind: "openapi";
};

type ToolIntent = DemoToolIntent | OpenApiToolIntent;

const demoOrders: Record<string, JsonRecord> = {
  "ORD-2026-1001": {
    found: true,
    order_id: "ORD-2026-1001",
    status: "paid",
    amount: "588.00",
    currency: "USD",
    plan: "Growth Annual",
    paid_at: "2026-06-01",
    receipt_email: "billing@northstar.example"
  }
};

const demoSubscriptions: Record<string, JsonRecord> = {
  demo_user_8462: {
    found: true,
    external_user_id: "demo_user_8462",
    status: "active",
    plan: "Growth Annual",
    seats: 47,
    renewal_date: "2026-09-24",
    cancel_at_period_end: false
  }
};

export async function maybeRunBusinessTool(
  repository: SupportRepository,
  input: {
    projectId: string;
    conversationId: string;
    text: string;
  },
  options: BusinessToolOptions = {}
): Promise<BusinessToolResult | undefined> {
  const intent = await detectToolIntent(repository, input);
  if (!intent) {
    return undefined;
  }

  const tool = await repository.findToolDefinitionBySlug({
    projectId: input.projectId,
    slug: intent.slug
  });
  if (!tool || tool.status !== "active") {
    return undefined;
  }

  const startedAt = Date.now();
  try {
    let output: JsonRecord;
    let answer: string;
    if (tool.kind === "openapi") {
      if (!isOpenApiIntent(intent)) {
        return undefined;
      }
      output = await executeOpenApiTool(tool, intent.input, options);
      answer = formatOpenApiToolAnswer(tool, intent.input, output);
    } else {
      if (isOpenApiIntent(intent)) {
        return undefined;
      }
      output = executeDemoTool(intent);
      answer = formatDemoToolAnswer(intent.slug, output);
    }
    const toolCall = await repository.createToolCall({
      projectId: input.projectId,
      conversationId: input.conversationId,
      toolId: tool.id,
      toolSlug: tool.slug,
      status: "completed",
      input: intent.input,
      output,
      latencyMs: Date.now() - startedAt
    });

    return {
      answer,
      tool,
      toolCall
    };
  } catch (error) {
    const toolCall = await repository.createToolCall({
      projectId: input.projectId,
      conversationId: input.conversationId,
      toolId: tool.id,
      toolSlug: tool.slug,
      status: "failed",
      input: intent.input,
      error: error instanceof Error ? error.message : "Unknown tool execution error",
      latencyMs: Date.now() - startedAt
    });
    return {
      answer: `我暂时无法完成 ${tool.name} 查询。请稍后重试，或转人工继续处理。`,
      tool,
      toolCall
    };
  }
}

function isOpenApiIntent(intent: ToolIntent): intent is OpenApiToolIntent {
  return "kind" in intent && intent.kind === "openapi";
}

async function detectToolIntent(
  repository: SupportRepository,
  input: {
    projectId: string;
    conversationId: string;
    text: string;
  }
): Promise<ToolIntent | undefined> {
  const openApiIntent = await detectOpenApiToolIntent(repository, input);
  if (openApiIntent) {
    return openApiIntent;
  }

  const orderId = input.text.match(/\bORD-\d{4}-\d{4}\b/i)?.[0]?.toUpperCase();
  if (orderId) {
    return {
      slug: "demo.order_lookup",
      input: {
        order_id: orderId
      }
    };
  }

  if (
    !/(订阅状态|当前订阅|我的订阅|套餐|续费|subscription status|current subscription|plan status)/i.test(
      input.text
    )
  ) {
    return undefined;
  }

  const conversation = await repository.findConversation(input.projectId, input.conversationId);
  const contact = conversation
    ? await repository.findContact(input.projectId, conversation.contactId)
    : undefined;
  if (!contact?.externalUserId) {
    return undefined;
  }

  return {
    slug: "demo.subscription_lookup",
    input: {
      external_user_id: contact.externalUserId
    }
  };
}

async function detectOpenApiToolIntent(
  repository: SupportRepository,
  input: {
    projectId: string;
    text: string;
  }
): Promise<OpenApiToolIntent | undefined> {
  const tools = await repository.listToolDefinitions({
    projectId: input.projectId,
    status: "active",
    limit: 100
  });
  for (const tool of tools) {
    if (tool.kind !== "openapi") {
      continue;
    }
    const intent = recordValue(tool.metadata["intent"]);
    if (!intent) {
      continue;
    }
    const keywords = stringArray(intent["keywords"]);
    if (
      keywords.length > 0 &&
      !keywords.some((keyword) => input.text.toLowerCase().includes(keyword.toLowerCase()))
    ) {
      continue;
    }
    const extracted = extractIntentInput(input.text, intent);
    const defaults = recordValue(tool.metadata["default_input"]) ?? {};
    const candidate = {
      ...defaults,
      ...extracted
    };
    if (!requiredFieldsPresent(tool.inputSchema, candidate)) {
      continue;
    }
    return {
      slug: tool.slug,
      input: candidate,
      kind: "openapi"
    };
  }
  return undefined;
}

function extractIntentInput(text: string, intent: JsonRecord): JsonRecord {
  const extract = recordValue(intent["extract"]);
  if (!extract) {
    return {};
  }
  const field = stringValue(extract["field"]);
  const pattern = stringValue(extract["pattern"]);
  if (!field || !pattern) {
    return {};
  }
  const flags = stringValue(extract["flags"]) ?? "i";
  const match = text.match(new RegExp(pattern, flags));
  if (!match) {
    return {};
  }
  return {
    [field]: match[1] ?? match[0]
  };
}

async function executeOpenApiTool(
  tool: ToolDefinitionRecord,
  input: JsonRecord,
  options: BusinessToolOptions
): Promise<JsonRecord> {
  const method = (tool.method ?? "GET").toUpperCase();
  const path = tool.path;
  if (!path) {
    throw new Error("OpenAPI tool path is not configured");
  }
  if (method !== "GET" && options.allowMutations === false) {
    throw new Error("OpenAPI tool mutations are disabled in asynchronous answer workers");
  }
  if (method !== "GET" && !hasMutationApproval(tool)) {
    throw new Error("OpenAPI tool mutation requires persisted operator approval");
  }

  const url = buildToolUrl(tool, input);
  assertAllowedToolHost(tool, url);
  const timeoutMs = numberValue(tool.metadata["timeout_ms"]) ?? 3000;
  const maxResponseBytes = numberValue(tool.metadata["max_response_bytes"]) ?? 65_536;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method,
      headers: buildOpenApiToolHeaders(tool, method),
      body: method === "GET" ? undefined : JSON.stringify(input),
      signal: controller.signal
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
      throw new Error("OpenAPI tool response exceeded max_response_bytes");
    }
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`OpenAPI tool returned HTTP ${response.status}`);
    }
    const record = recordValue(payload);
    if (!record) {
      throw new Error("OpenAPI tool response must be a JSON object");
    }
    const outputPath = stringValue(tool.metadata["response_path"]);
    return outputPath ? pickRecordPath(record, outputPath) : record;
  } finally {
    clearTimeout(timeout);
  }
}

function hasMutationApproval(tool: ToolDefinitionRecord): boolean {
  const approval = recordValue(tool.metadata["mutation_approval"]);
  const approvedAt = stringValue(approval?.["approved_at"]);
  return (
    tool.metadata["allow_mutation"] === true &&
    approval?.["status"] === "approved" &&
    Boolean(stringValue(approval["approved_by"])) &&
    Boolean(approvedAt && !Number.isNaN(Date.parse(approvedAt)))
  );
}

function buildToolUrl(tool: ToolDefinitionRecord, input: JsonRecord): URL {
  const baseUrl = stringValue(tool.metadata["base_url"]);
  const path = interpolatePath(tool.path ?? "", input);
  return baseUrl ? new URL(path, baseUrl) : new URL(path);
}

function interpolatePath(path: string, input: JsonRecord): string {
  return path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = input[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`Missing OpenAPI tool path input: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

function assertAllowedToolHost(tool: ToolDefinitionRecord, url: URL): void {
  const allowedHosts = stringArray(tool.metadata["allowed_hosts"]);
  if (allowedHosts.length === 0 || !allowedHosts.includes(url.host)) {
    throw new Error(`OpenAPI tool host is not allowed: ${url.host}`);
  }
}

function buildOpenApiToolHeaders(tool: ToolDefinitionRecord, method: string): Headers {
  const headers = new Headers({
    accept: "application/json"
  });
  if (method !== "GET") {
    headers.set("content-type", "application/json");
  }
  const auth = recordValue(tool.metadata["auth"]);
  if (auth?.["type"] === "bearer_env") {
    const envName = stringValue(auth["env"]);
    const token = envName ? process.env[envName] : undefined;
    if (!token) {
      throw new Error("OpenAPI tool auth token is not configured");
    }
    headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

function pickRecordPath(record: JsonRecord, path: string): JsonRecord {
  const value = path.split(".").reduce<unknown>((current, segment) => {
    const item = recordValue(current);
    return item?.[segment];
  }, record);
  const selected = recordValue(value);
  if (!selected) {
    throw new Error(`OpenAPI tool response_path did not resolve to an object: ${path}`);
  }
  return selected;
}

function executeDemoTool(intent: DemoToolIntent): JsonRecord {
  if (intent.slug === "demo.order_lookup") {
    return (
      demoOrders[intent.input.order_id] ?? {
        found: false,
        order_id: intent.input.order_id
      }
    );
  }

  return (
    demoSubscriptions[intent.input.external_user_id] ?? {
      found: false,
      external_user_id: intent.input.external_user_id
    }
  );
}

function formatDemoToolAnswer(
  slug: "demo.order_lookup" | "demo.subscription_lookup",
  output: JsonRecord
): string {
  if (!output["found"]) {
    if (slug === "demo.order_lookup") {
      return `我没有查到订单 ${String(output["order_id"])}。请确认订单号是否正确，或转人工继续核对。`;
    }
    return "我没有查到当前用户的订阅记录。请转人工继续核对账号信息。";
  }

  if (slug === "demo.order_lookup") {
    return [
      `我查到订单 ${String(output["order_id"])}：状态为 ${String(output["status"])}。`,
      `金额 ${String(output["currency"])} ${String(output["amount"])}，套餐为 ${String(output["plan"])}。`,
      `收据会发送到 ${String(output["receipt_email"])}。`
    ].join("\n");
  }

  return [
    `我查到当前订阅状态为 ${String(output["status"])}，套餐是 ${String(output["plan"])}。`,
    `席位数 ${String(output["seats"])}，下次续费日期是 ${String(output["renewal_date"])}。`,
    output["cancel_at_period_end"]
      ? "当前订阅已设置周期结束后取消。"
      : "当前没有设置周期结束后取消。"
  ].join("\n");
}

function formatOpenApiToolAnswer(
  tool: ToolDefinitionRecord,
  input: JsonRecord,
  output: JsonRecord
): string {
  const template = stringValue(tool.metadata["answer_template"]);
  if (template) {
    return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, key: string) => {
      const value = valueAtPath({ ...input, ...output }, key);
      return value === undefined ? "" : String(value);
    });
  }
  const answer = stringValue(output["answer"]) ?? stringValue(output["summary"]);
  if (answer) {
    return answer;
  }
  return `${tool.name} 已返回结果：${JSON.stringify(output)}`;
}

function valueAtPath(record: JsonRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    const item = recordValue(current);
    return item?.[segment];
  }, record);
}

function requiredFieldsPresent(schema: JsonRecord, input: JsonRecord): boolean {
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter((field): field is string => typeof field === "string")
    : [];
  return required.every((field) => input[field] !== undefined && input[field] !== "");
}

function recordValue(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}
