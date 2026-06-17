export type KnowledgeSourceType = "manual" | "url" | "sitemap" | "upload";

export type KnowledgeDocumentStatus = "pending" | "indexing" | "indexed" | "failed";

export type KnowledgeDocument = {
  id: string;
  projectId: string;
  title: string;
  sourceType: "markdown" | "text" | "url" | "pdf";
  status: KnowledgeDocumentStatus;
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
