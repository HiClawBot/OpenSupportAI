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

type ToolIntent =
  | {
      slug: "demo.order_lookup";
      input: { order_id: string };
    }
  | {
      slug: "demo.subscription_lookup";
      input: { external_user_id: string };
    };

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
  }
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
  const output = executeDemoTool(intent);
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
    answer: formatToolAnswer(intent.slug, output),
    tool,
    toolCall
  };
}

async function detectToolIntent(
  repository: SupportRepository,
  input: {
    projectId: string;
    conversationId: string;
    text: string;
  }
): Promise<ToolIntent | undefined> {
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

function executeDemoTool(intent: ToolIntent): JsonRecord {
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

function formatToolAnswer(slug: ToolIntent["slug"], output: JsonRecord): string {
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
