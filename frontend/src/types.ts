// Shared API types mirroring backend responses (SPEC F1-F7).

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface AuthResponse {
  token: string;
  user: { id: string; email: string };
}

export interface AiInfo {
  modelId: string;
  promptVersion: string;
  retrievedChunkIds: string[];
  confidence: number | null;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface Citation {
  chunkId: string;
  quote: string;
}

export interface ChatResponse {
  conversationId: string;
  answer: string;
  confidence: number | null;
  citations: Citation[];
  ai: AiInfo;
}

export interface DocumentView {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
  charCount: number | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  errorDetail: string | null;
  createdAt: string;
  processedAt: string | null;
}

export type ChatStreamEvent =
  | { type: 'status'; status: 'thinking' }
  | { type: 'delta'; text: string }
  | { type: 'done'; output: Omit<ChatResponse, 'conversationId'>; conversationId: string }
  | { type: 'error'; message: string };
