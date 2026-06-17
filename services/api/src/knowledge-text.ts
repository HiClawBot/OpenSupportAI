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

export function tokenize(value: string): string[] {
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

export function scoreChunk(content: string, terms: string[]): number {
  const lower = content.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term.toLowerCase()) ? 1 : 0), 0);
}
