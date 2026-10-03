export interface ChunkOptions {
  chunkTokens: number;
  overlapTokens: number;
}

export interface TextChunk {
  chunkIndex: number;
  content: string;
  tokenEst: number;
}

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/**
 * Paragraph-aware chunking with sentence fallback (SPEC D3).
 * Units = paragraphs; oversized paragraphs split at sentence boundaries;
 * oversized sentences hard-split at chunkTokens. Consecutive chunks share
 * `overlapTokens` worth of trailing units so answers spanning a boundary
 * stay retrievable.
 */
export function chunkText(text: string, options: ChunkOptions): TextChunk[] {
  const { chunkTokens, overlapTokens } = options;
  const maxChars = chunkTokens * CHARS_PER_TOKEN;
  const overlapChars = Math.min(overlapTokens * CHARS_PER_TOKEN, Math.floor(maxChars / 2));

  const units = splitIntoUnits(text, maxChars);
  if (units.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentChars = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const content = current.join("\n\n").trim();
    if (content.length > 0) {
      chunks.push({ chunkIndex: chunks.length, content, tokenEst: estimateTokens(content) });
    }
    // Keep trailing units up to overlapChars for the next chunk.
    const overlap: string[] = [];
    let overlapSize = 0;
    for (const unit of [...current].reverse()) {
      if (overlapSize + unit.length > overlapChars && overlap.length > 0) break;
      overlap.unshift(unit);
      overlapSize += unit.length;
      if (overlapSize >= overlapChars) break;
    }
    current = overlapSize > 0 && overlapSize < content.length ? overlap : [];
    currentChars = current.reduce((sum, u) => sum + u.length, 0);
  };

  for (const unit of units) {
    if (currentChars + unit.length > maxChars && current.length > 0) {
      flush();
    }
    current.push(unit);
    currentChars += unit.length;
  }
  flush();

  return chunks;
}

function splitIntoUnits(text: string, maxChars: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) {
      if (sentence.length <= maxChars) {
        units.push(sentence);
      } else {
        for (let i = 0; i < sentence.length; i += maxChars) {
          const slice = sentence.slice(i, i + maxChars).trim();
          if (slice.length > 0) units.push(slice);
        }
      }
    }
  }
  return units;
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
