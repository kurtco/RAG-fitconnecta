import { describe, expect, it } from "vitest";
import { retrieveChunks } from "../src/rag/retrieve.js";
import { MockEmbeddingProvider } from "../src/rag/embed.js";
import type { ChunkInsert, ChunkRepository } from "../src/domain/ports.js";
import type { RetrievedChunk } from "../src/domain/types.js";

function fakeChunkRepo(results: RetrievedChunk[]): ChunkRepository {
  return {
    insertMany: async (_chunks: ChunkInsert[]) => {},
    searchSimilar: async () => results,
  };
}

const base = {
  documentId: "doc-1",
  chunkIndex: 0,
  tokenEst: 10,
};

describe("retrieveChunks", () => {
  it("filters out results below minScore", async () => {
    const repo = fakeChunkRepo([
      { ...base, id: "high", content: "relevant", score: 0.82 },
      { ...base, id: "low", content: "noise", chunkIndex: 1, score: 0.11 },
    ]);
    const result = await retrieveChunks(
      { embeddings: new MockEmbeddingProvider(), chunks: repo },
      "user-1",
      "question?",
      { topK: 5, minScore: 0.35 },
    );
    expect(result.map((r) => r.id)).toEqual(["high"]);
  });

  it("returns empty when nothing matches (triggers not-grounded path)", async () => {
    const result = await retrieveChunks(
      { embeddings: new MockEmbeddingProvider(), chunks: fakeChunkRepo([]) },
      "user-1",
      "question?",
      { topK: 5, minScore: 0.35 },
    );
    expect(result).toEqual([]);
  });
});
