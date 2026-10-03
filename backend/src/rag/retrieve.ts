import type { ChunkRepository, EmbeddingProvider } from "../domain/ports.js";
import type { RetrievedChunk } from "../domain/types.js";

export interface RetrieveDeps {
  embeddings: EmbeddingProvider;
  chunks: ChunkRepository;
}

export interface RetrieveOptions {
  topK: number;
  minScore: number;
}

/**
 * Embeds the question and returns owner-scoped chunks above the score
 * threshold (SPEC D3). Empty result => pipeline answers "not grounded"
 * without calling the LLM.
 */
export async function retrieveChunks(
  deps: RetrieveDeps,
  ownerId: string,
  question: string,
  options: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const [queryVector] = await deps.embeddings.embed([question]);
  if (!queryVector) {
    return [];
  }
  const results = await deps.chunks.searchSimilar(ownerId, queryVector, options.topK);
  return results.filter((chunk) => chunk.score >= options.minScore);
}
