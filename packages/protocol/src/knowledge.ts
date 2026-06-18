export type KnowledgeSourceType = "manual" | "url" | "sitemap" | "upload";

export type KnowledgeDocumentStatus = "pending" | "indexing" | "indexed" | "failed";

export type KnowledgeDocument = {
  id: string;
  projectId: string;
  title: string;
  sourceType: "markdown" | "text" | "url" | "pdf";
  sourceUri?: string;
  status: KnowledgeDocumentStatus;
  contentHash?: string;
  metadata: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunk = {
  id: string;
  projectId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number;
};
