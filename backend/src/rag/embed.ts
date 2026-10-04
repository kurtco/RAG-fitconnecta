import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { EmbeddingProvider } from "../domain/ports.js";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly dimensions = 1536;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: { apiKey: string; model: string; timeoutMs?: number }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 30_000,
      maxRetries: 1,
    });
    this.model = options.model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors: number[][] = [];
    // Batch to keep payloads reasonable (OpenAI allows up to 2048 inputs).
    const batchSize = 100;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.client.embeddings.create({ model: this.model, input: batch });
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      vectors.push(...sorted.map((d) => d.embedding));
    }
    return vectors;
  }
}

/**
 * Deterministic lexical embeddings for tests and no-key demos.
 * Feature hashing: each (stopword-filtered) token is hashed into a dimension;
 * texts sharing vocabulary get proportional cosine similarity, unrelated
 * texts stay near 0, identical texts give exactly 1. Not semantic — it
 * exercises the retrieval plumbing, nothing more.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  constructor(readonly dimensions: number = 1536) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => lexicalUnitVector(text, this.dimensions));
  }
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from",
  "had", "has", "have", "how", "in", "is", "it", "its", "much", "many", "of", "on",
  "or", "that", "the", "to", "was", "were", "what", "when", "which", "who", "why",
  "with", "you", "your", "question", "answer",
]);

function lexicalUnitVector(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    // Naive 5-char stem: matches morphological variants (client/clients,
    // onboarded/onboarding, exceed/exceeding). Deterministic, test-only.
    .map((t) => t.slice(0, 5));

  for (const token of tokens) {
    const hash = createHash("sha256").update(token).digest();
    const index = hash.readUInt32BE(0) % dimensions;
    const sign = (hash[4]! & 1) === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

export function createEmbeddingProvider(input: {
  provider: "openai" | "mock";
  openaiApiKey?: string;
  openaiEmbeddingModel: string;
}): EmbeddingProvider {
  if (input.provider === "mock") {
    return new MockEmbeddingProvider();
  }
  if (!input.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
  }
  return new OpenAIEmbeddingProvider({
    apiKey: input.openaiApiKey,
    model: input.openaiEmbeddingModel,
  });
}
