import type {
  ConversationInsightRecord,
  ConversationRecord,
  HandoffSessionRecord,
  MessageRecord,
  SupportRepository,
  ToolCallRecord
} from "./repositories/types";

export type HandoffAnalyticsResult = {
  generated_at: string;
  total: number;
  by_status: Record<string, number>;
  by_reason: Record<string, number>;
  by_provider: Record<string, number>;
};

export async function generateConversationInsight(
  repository: SupportRepository,
  input: {
    projectId: string;
    conversationId: string;
  }
): Promise<ConversationInsightRecord> {
  const conversation = await repository.findConversation(input.projectId, input.conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`);
  }

  const [messages, handoffSessions, toolCalls] = await Promise.all([
    repository.listMessages(input.projectId, input.conversationId),
    repository.listHandoffSessions({
      projectId: input.projectId,
      conversationId: input.conversationId
    }),
    repository.listToolCalls({
      projectId: input.projectId,
      conversationId: input.conversationId
    })
  ]);
  const latestHandoff = newestHandoff(handoffSessions);
  const tags = inferTags(conversation, messages, handoffSessions, toolCalls);
  const suggestedReplies = suggestReplies(tags, latestHandoff, toolCalls);

  return repository.upsertConversationInsight({
    projectId: input.projectId,
    conversationId: input.conversationId,
    summary: summarizeConversation(conversation, messages, latestHandoff, toolCalls),
    suggestedReplies,
    tags,
    metadata: {
      message_count: messages.length,
      tool_call_count: toolCalls.length,
      latest_handoff_status: latestHandoff?.status,
      generated_by: "deterministic_agent_assist_v0.4"
    }
  });
}

export async function buildHandoffAnalytics(
  repository: SupportRepository,
  projectId: string
): Promise<HandoffAnalyticsResult> {
  const handoffs = await repository.listHandoffSessions({ projectId });
  return {
    generated_at: new Date().toISOString(),
    total: handoffs.length,
    by_status: countBy(handoffs, (handoff) => handoff.status),
    by_reason: countBy(handoffs, (handoff) => handoff.reason ?? "unspecified"),
    by_provider: countBy(handoffs, (handoff) => handoff.provider)
  };
}

function summarizeConversation(
  conversation: ConversationRecord,
  messages: MessageRecord[],
  latestHandoff: HandoffSessionRecord | undefined,
  toolCalls: ToolCallRecord[]
): string {
  const latestUser = [...messages].reverse().find((message) => message.role === "end_user");
  const latestResponse = [...messages]
    .reverse()
    .find((message) => message.role === "ai_agent" || message.role === "human_agent");
  const parts = [
    `Conversation ${conversation.id} is ${conversation.status} with ${conversation.assigneeType} assignee.`
  ];
  if (latestUser) {
    parts.push(`Latest user message: ${truncate(textFromMessage(latestUser), 180)}`);
  }
  if (latestResponse) {
    parts.push(`Latest response: ${truncate(textFromMessage(latestResponse), 180)}`);
  }
  if (toolCalls.length > 0) {
    parts.push(
      `Recent tools: ${toolCalls
        .slice(0, 3)
        .map((call) => call.toolSlug)
        .join(", ")}.`
    );
  }
  if (latestHandoff) {
    parts.push(`Latest handoff is ${latestHandoff.status} via ${latestHandoff.provider}.`);
  }
  return parts.join(" ");
}

function inferTags(
  conversation: ConversationRecord,
  messages: MessageRecord[],
  handoffSessions: HandoffSessionRecord[],
  toolCalls: ToolCallRecord[]
): string[] {
  const corpus = messages.map(textFromMessage).join(" ").toLowerCase();
  const tags = new Set<string>();
  if (/refund|退款/.test(corpus)) tags.add("billing.refund");
  if (/subscription|订阅|套餐|续费/.test(corpus)) tags.add("billing.subscription");
  if (/order|订单|ord-\d{4}-\d{4}/i.test(corpus)) tags.add("billing.order");
  if (/cancel|取消/.test(corpus)) tags.add("billing.cancel");
  if (conversation.status === "handoff_requested" || conversation.status === "handed_off") {
    tags.add("handoff.active");
  }
  if (handoffSessions.some((handoff) => handoff.status === "failed")) {
    tags.add("handoff.failed");
  }
  if (toolCalls.length > 0) {
    tags.add("tool.used");
  }
  if (messages.some((message) => message.metadata?.["no_hit"])) {
    tags.add("knowledge.no_hit");
  }
  return [...tags].sort();
}

function suggestReplies(
  tags: string[],
  latestHandoff: HandoffSessionRecord | undefined,
  toolCalls: ToolCallRecord[]
): string[] {
  if (latestHandoff?.status === "active") {
    return [
      "我已经接入，会继续基于前面的对话记录处理。",
      "我先核对订单和订阅信息，再给你明确答复。"
    ];
  }
  if (tags.includes("billing.refund")) {
    return [
      "请提供订单号和付款邮箱，我会帮你核对退款条件。",
      "退款需要人工审核，我可以为你转接客服继续处理。"
    ];
  }
  if (toolCalls.some((call) => call.toolSlug === "demo.order_lookup")) {
    return ["我已经查到订单状态。还需要我帮你核对收据或订阅信息吗？"];
  }
  if (tags.includes("billing.subscription")) {
    return ["你的订阅在当前周期内仍可继续使用。需要我帮你查看续费日期或取消状态吗？"];
  }
  return ["我可以继续帮你核对账单、订阅、订单或转人工处理。"];
}

function newestHandoff(handoffSessions: HandoffSessionRecord[]): HandoffSessionRecord | undefined {
  return [...handoffSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function countBy<T>(items: T[], keyForItem: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function textFromMessage(message: MessageRecord): string {
  const text = message.content["text"];
  return typeof text === "string" ? text : "";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
