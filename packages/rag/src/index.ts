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

export const MIN_LEXICAL_RELEVANCE = 0.34;
export const MIN_TRIGRAM_RELEVANCE = 0.6;

const englishStopTerms = new Set([
  "and",
  "are",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "help",
  "how",
  "is",
  "it",
  "me",
  "my",
  "please",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would"
]);

const cjkQuestionPrefixes =
  /^(?:这个|那个|请问|请帮我|麻烦|帮我|怎么|如何|为什么|能否|可以|能不能)+/u;
const cjkQuestionSuffixes =
  /(?:怎么办|怎么做|是什么|在哪里|为什么|多久到账|要多久|多久|多少|可以吗|吗|呢)+$/u;

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
  const terms = lexicalQueryTerms(query);
  if (terms.length === 0) {
    return createNoHitResult();
  }

  const results = chunks
    .filter((chunk) => chunk.projectId === projectId)
    .map((chunk) => ({
      ...chunk,
      score: scoreLexicalChunk(chunk.content, terms)
    }))
    .filter((chunk) => chunk.score >= MIN_LEXICAL_RELEVANCE)
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(limit, 20)));

  const topResult = results[0];
  if (!topResult) {
    return createNoHitResult();
  }

  return {
    chunks: results,
    confidence: topResult.score
  };
}

export function lexicalQueryTerms(value: string, maxTerms = 24): string[] {
  const normalized = normalizeLexicalText(value);
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Latin}\p{Number}]+/gu)) {
    const term = match[0];
    if (term.length >= 2 && (!englishStopTerms.has(term) || /\p{Number}/u.test(term))) {
      terms.add(term);
    }
  }

  for (const match of normalized.matchAll(/\p{Script=Han}{2,}/gu)) {
    const segment = normalizeCjkQuestion(match[0]);
    if (segment.length < 2) continue;
    if (segment.length <= 12) {
      terms.add(segment);
    }
    for (let size = Math.min(4, segment.length); size >= 2; size -= 1) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        terms.add(segment.slice(index, index + size));
      }
    }
  }

  return [...terms]
    .sort((left, right) => [...right].length - [...left].length || left.localeCompare(right))
    .slice(0, Math.max(1, maxTerms));
}

export function scoreLexicalChunk(content: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const normalizedContent = normalizeLexicalText(content);
  const matched = terms.filter((term) => normalizedContent.includes(term));
  if (matched.length === 0) {
    return 0;
  }

  const weight = (term: string) => Math.min(6, [...term].length);
  const totalWeight = terms.reduce((sum, term) => sum + weight(term), 0);
  const matchedWeight = matched.reduce((sum, term) => sum + weight(term), 0);
  const longestTerm = Math.max(...terms.map((term) => [...term].length));
  const longestMatch = Math.max(...matched.map((term) => [...term].length));
  const anchor = longestMatch / Math.max(longestTerm, 1);
  const coverage = matchedWeight / Math.max(totalWeight, 1);
  const diversity = Math.min(1, matched.length / Math.min(4, terms.length));

  return roundScore(Math.min(1, anchor * 0.55 + coverage * 0.3 + diversity * 0.15));
}

export function normalizeLexicalText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function normalizeCjkQuestion(value: string): string {
  let normalized = value;
  let previous = "";
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(cjkQuestionPrefixes, "").replace(cjkQuestionSuffixes, "");
  }
  return normalized;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
