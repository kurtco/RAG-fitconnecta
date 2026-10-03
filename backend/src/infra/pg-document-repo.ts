import type { Pool } from "./db.js";
import type { DocumentRecord } from "../domain/types.js";
import type { DocumentRepository } from "../domain/ports.js";

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    ownerId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<DocumentRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO documents (owner_id, filename, mime_type, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5)
       ${RETURNING}`,
      [input.ownerId, input.filename, input.mimeType, input.sizeBytes, input.sha256],
    );
    return toDocument(rows[0]!);
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<DocumentRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNS} FROM documents WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async listForOwner(ownerId: string): Promise<DocumentRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNS} FROM documents WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [ownerId],
    );
    return rows.map(toDocument);
  }

  async markProcessing(id: string): Promise<void> {
    await this.pool.query(`UPDATE documents SET status = 'processing' WHERE id = $1`, [id]);
  }

  async markReady(id: string, stats: { charCount: number; chunkCount: number }): Promise<void> {
    await this.pool.query(
      `UPDATE documents SET status = 'ready', char_count = $2, chunk_count = $3,
              processed_at = now() WHERE id = $1`,
      [id, stats.charCount, stats.chunkCount],
    );
  }

  async markFailed(id: string, errorDetail: string): Promise<void> {
    await this.pool.query(
      `UPDATE documents SET status = 'failed', error_detail = $2, processed_at = now()
       WHERE id = $1`,
      [id, errorDetail.slice(0, 500)],
    );
  }
}

const COLUMNS = `id, owner_id, filename, mime_type, size_bytes, sha256, char_count,
                 chunk_count, status, error_detail, created_at, processed_at`;
const RETURNING = `RETURNING ${COLUMNS}`;

interface DocumentRow {
  id: string;
  owner_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  char_count: number | null;
  chunk_count: number;
  status: DocumentRecord["status"];
  error_detail: string | null;
  created_at: Date;
  processed_at: Date | null;
}

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    charCount: row.char_count,
    chunkCount: row.chunk_count,
    status: row.status,
    errorDetail: row.error_detail,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}
