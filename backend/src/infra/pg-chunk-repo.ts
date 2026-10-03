import type { Pool } from "./db.js";
import type { RetrievedChunk } from "../domain/types.js";
import type { ChunkInsert, ChunkRepository } from "../domain/ports.js";

/** pgvector literal format: '[0.1,0.2,...]' */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class PgChunkRepository implements ChunkRepository {
  constructor(private readonly pool: Pool) {}

  async insertMany(chunks: ChunkInsert[]): Promise<void> {
    if (chunks.length === 0) return;
    const values: unknown[] = [];
    const placeholders = chunks.map((chunk, i) => {
      const base = i * 5;
      values.push(
        chunk.documentId,
        chunk.chunkIndex,
        chunk.content,
        chunk.tokenEst,
        toVectorLiteral(chunk.embedding),
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`;
    });
    await this.pool.query(
      `INSERT INTO chunks (document_id, chunk_index, content, token_est, embedding)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (document_id, chunk_index) DO NOTHING`,
      values,
    );
  }

  /**
   * Cosine similarity search scoped to the requesting owner's documents
   * (multi-user data isolation). Uses the HNSW index from init.sql.
   */
  async searchSimilar(
    ownerId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<RetrievedChunk[]> {
    const { rows } = await this.pool.query(
      `SELECT c.id, c.document_id, c.chunk_index, c.content, c.token_est,
              d.filename,
              1 - (c.embedding <=> $2::vector) AS score
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.owner_id = $1 AND c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $2::vector
       LIMIT $3`,
      [ownerId, toVectorLiteral(queryEmbedding), topK],
    );
    return rows.map((row) => ({
      id: row.id as string,
      documentId: row.document_id as string,
      chunkIndex: row.chunk_index as number,
      content: row.content as string,
      tokenEst: row.token_est as number,
      filename: row.filename as string,
      score: Number(row.score),
    }));
  }
}
