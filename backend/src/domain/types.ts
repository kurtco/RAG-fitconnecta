/**
 * Domain types. This module must stay free of framework/SDK imports
 * (see AGENTS.md principle 2: ports & adapters).
 */

export type MessageRole = "user" | "assistant";
export type LlmRole = "system" | "user" | "assistant";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface DocumentRecord {
  id: string;
  ownerId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  charCount: number | null;
  chunkCount: number;
  status: "pending" | "processing" | "ready" | "failed";
  errorDetail: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenEst: number;
}

/** A chunk returned by vector retrieval, with cosine similarity score. */
export interface RetrievedChunk extends ChunkRecord {
  score: number;
  filename?: string;
}

export interface Conversation {
  id: string;
  ownerId: string;
  title: string | null;
  createdAt: Date;
}

/** AI traceability metadata persisted with every assistant message (SPEC D2). */
export interface AiMetadata {
  modelId: string;
  promptVersion: string;
  retrievedChunkIds: string[];
  confidence: number | null;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  ai: AiMetadata | null;
  createdAt: Date;
}

export interface ChatHistoryEntry {
  role: MessageRole;
  content: string;
}
