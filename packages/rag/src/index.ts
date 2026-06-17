import type { KnowledgeChunk } from "@opensupportai/protocol";

export type RetrievalResult = {
  chunks: RetrievedKnowledgeChunk[];
  confidence: number;
};

export type RetrievedKnowledgeChunk = KnowledgeChunk & {
  score: number;
};

export type IndexTextDocumentInput = {
  projectId: string;
  documentId: string;
  content: string;
  metadata?: Record<string, unknown>;
  chunkSize?: number;
};

export function createNoHitResult(): RetrievalResult {
  return {
    chunks: [],
    confidence: 0
  };
}

export function chunkText(content: string, chunkSize = 900): string[] {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && `${current}\n\n${paragraph}`.length > chunkSize) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function indexTextDocument(input: IndexTextDocumentInput): KnowledgeChunk[] {
  return chunkText(input.content, input.chunkSize).map((content, index) => ({
    id: `${input.documentId}_chunk_${index}`,
    projectId: input.projectId,
    documentId: input.documentId,
    chunkIndex: index,
    content,
    tokenCount: content.length,
    metadata: input.metadata ?? {}
  }));
}

export function retrieveByKeyword(
  projectId: string,
  query: string,
  chunks: KnowledgeChunk[],
  limit = 6
): RetrievalResult {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return createNoHitResult();
  }

  const results = chunks
    .filter((chunk) => chunk.projectId === projectId)
    .map((chunk) => ({
      ...chunk,
      score: score(chunk.content, terms)
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const topResult = results[0];
  if (!topResult) {
    return createNoHitResult();
  }

  return {
    chunks: results,
    confidence: Math.min(1, 0.35 + topResult.score / Math.max(terms.length, 1))
  };
}

function tokenize(value: string): string[] {
  const asciiTerms = value
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((term) => term.length >= 2);
  const cjkTerms = [...value.matchAll(/\p{Script=Han}{2,}/gu)].flatMap((match) => {
    const text = match[0];
    const terms = [text];
    for (let size = 2; size <= Math.min(4, text.length); size += 1) {
      for (let index = 0; index <= text.length - size; index += 1) {
        terms.push(text.slice(index, index + size));
      }
    }
    return terms;
  });
  return [...new Set([...asciiTerms, ...cjkTerms])];
}

function score(content: string, terms: string[]): number {
  const lower = content.toLowerCase();
  return terms.reduce((sum, term) => sum + (lower.includes(term.toLowerCase()) ? 1 : 0), 0);
}
