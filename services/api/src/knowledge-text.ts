export function chunkText(content: string): string[] {
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
    if ((current + "\n\n" + paragraph).length > 1200 && current) {
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

export {
  lexicalQueryTerms,
  MIN_LEXICAL_RELEVANCE,
  MIN_TRIGRAM_RELEVANCE,
  normalizeLexicalText,
  scoreLexicalChunk as scoreChunk,
  lexicalQueryTerms as tokenize
} from "@opensupportai/rag";
