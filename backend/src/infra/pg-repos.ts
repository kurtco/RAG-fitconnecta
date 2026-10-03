import type { Pool } from "./db.js";
import type { AiMetadata, Conversation, Message, MessageRole } from "../domain/types.js";
import type { ConversationRepository, MessageRepository } from "../domain/ports.js";

export class PgConversationRepository implements ConversationRepository {
  constructor(private readonly pool: Pool) {}

  async create(ownerId: string, title?: string | null): Promise<Conversation> {
    const { rows } = await this.pool.query(
      `INSERT INTO conversations (owner_id, title) VALUES ($1, $2)
       RETURNING id, owner_id, title, created_at`,
      [ownerId, title ?? null],
    );
    return toConversation(rows[0]!);
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<Conversation | null> {
    const { rows } = await this.pool.query(
      `SELECT id, owner_id, title, created_at FROM conversations
       WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? toConversation(rows[0]) : null;
  }

  async listForOwner(ownerId: string): Promise<Conversation[]> {
    const { rows } = await this.pool.query(
      `SELECT id, owner_id, title, created_at FROM conversations
       WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [ownerId],
    );
    return rows.map(toConversation);
  }
}

export class PgMessageRepository implements MessageRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    ai?: Partial<AiMetadata>;
  }): Promise<Message> {
    const ai = input.ai;
    const { rows } = await this.pool.query(
      `INSERT INTO messages
         (conversation_id, role, content, model_id, prompt_version,
          retrieved_chunks, confidence, prompt_tokens, completion_tokens, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, conversation_id, role, content, model_id, prompt_version,
                 retrieved_chunks, confidence, prompt_tokens, completion_tokens,
                 latency_ms, created_at`,
      [
        input.conversationId,
        input.role,
        input.content,
        ai?.modelId ?? null,
        ai?.promptVersion ?? null,
        ai?.retrievedChunkIds ?? [],
        ai?.confidence ?? null,
        ai?.promptTokens ?? null,
        ai?.completionTokens ?? null,
        ai?.latencyMs ?? null,
      ],
    );
    return toMessage(rows[0]!);
  }

  async listByConversation(conversationId: string, limit = 20): Promise<Message[]> {
    const { rows } = await this.pool.query(
      `SELECT id, conversation_id, role, content, model_id, prompt_version,
              retrieved_chunks, confidence, prompt_tokens, completion_tokens,
              latency_ms, created_at
       FROM (
         SELECT * FROM messages WHERE conversation_id = $1
         ORDER BY created_at DESC LIMIT $2
       ) recent ORDER BY created_at ASC`,
      [conversationId, limit],
    );
    return rows.map(toMessage);
  }
}

interface ConversationRow {
  id: string;
  owner_id: string;
  title: string | null;
  created_at: Date;
}

function toConversation(row: ConversationRow): Conversation {
  return { id: row.id, ownerId: row.owner_id, title: row.title, createdAt: row.created_at };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  model_id: string | null;
  prompt_version: string | null;
  retrieved_chunks: string[] | null;
  confidence: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  created_at: Date;
}

function toMessage(row: MessageRow): Message {
  const ai: AiMetadata | null = row.model_id
    ? {
        modelId: row.model_id,
        promptVersion: row.prompt_version ?? "unknown",
        retrievedChunkIds: row.retrieved_chunks ?? [],
        confidence: row.confidence,
        promptTokens: row.prompt_tokens ?? 0,
        completionTokens: row.completion_tokens ?? 0,
        latencyMs: row.latency_ms ?? 0,
      }
    : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    ai,
    createdAt: row.created_at,
  };
}
