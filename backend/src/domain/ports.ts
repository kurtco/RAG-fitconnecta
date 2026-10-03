/**
 * Ports (contracts) implemented by adapters in ai/providers and infra.
 * Domain layer only — no SDK or framework imports allowed here.
 */

import type {
  AiMetadata,
  ChatHistoryEntry,
  Conversation,
  Message,
  User,
} from "./types.js";

// ---------- LLM ----------

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResult {
  content: string;
  modelId: string;
  usage: LlmUsage;
}

export type LlmStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: LlmResult }
  | { type: "error"; message: string };

export interface LLMProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResult>;
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}

// ---------- Repositories ----------

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(email: string, passwordHash: string): Promise<User>;
}

export interface ConversationRepository {
  create(ownerId: string, title?: string | null): Promise<Conversation>;
  findByIdForOwner(id: string, ownerId: string): Promise<Conversation | null>;
  listForOwner(ownerId: string): Promise<Conversation[]>;
}

export interface MessageRepository {
  create(input: {
    conversationId: string;
    role: Message["role"];
    content: string;
    ai?: Omit<AiMetadata, "retrievedChunkIds"> & { retrievedChunkIds?: string[] };
  }): Promise<Message>;
  listByConversation(conversationId: string, limit?: number): Promise<Message[]>;
}

// ---------- Chat pipeline (orchestrates the 3 stages) ----------

export interface ChatInput {
  question: string;
  history: ChatHistoryEntry[];
}

export interface ChatOutput {
  answer: string;
  confidence: number | null;
  citations: { chunkId: string; quote: string }[];
  ai: AiMetadata;
}
