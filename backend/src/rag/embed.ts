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
 * Deterministic hash-based embeddings for tests and no-key demos.
 * Identical text -> identical unit vector (cosine 1); different texts get
 * near-orthogonal vectors (cosine ~0), which is enough to exercise the
 * retrieval path end to end.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  constructor(readonly dimensions: number = 1536) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => seededUnitVector(text, this.dimensions));
  }
}

function seededUnitVector(text: string, dimensions: number): number[] {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const seed = createHash("sha256").update(normalized).digest();
  let state = seed.readUInt32BE(0);
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  const vector = Array.from({ length: dimensions }, () => next() * 2 - 1);
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
