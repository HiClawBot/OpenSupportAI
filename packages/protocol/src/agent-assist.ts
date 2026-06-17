export type ConversationInsight = {
  id: string;
  projectId: string;
  conversationId: string;
  summary: string;
  suggestedReplies: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type HandoffAnalytics = {
  generatedAt: string;
  total: number;
  byStatus: Record<string, number>;
  byReason: Record<string, number>;
  byProvider: Record<string, number>;
};
