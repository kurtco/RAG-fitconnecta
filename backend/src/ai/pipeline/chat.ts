import type {
  AiMetadata,
  ChatHistoryEntry,
  RetrievedChunk,
} from "../../domain/types.js";
import type {
  ChatOutput,
  LlmStreamEvent,
  LLMProvider,
} from "../../domain/ports.js";
import type { PromptTemplate } from "../prompts/qa.v1.js";
import { buildPrompt } from "./build-prompt.js";
import { invoke } from "./invoke.js";
import { processModelOutput } from "./post-process.js";

export interface ChatPipelineDeps {
  provider: LLMProvider;
  template: PromptTemplate;
  /** Phase 2 injects pgvector retrieval here; Phase 1 returns no context. */
  retrieveContext?: (question: string) => Promise<RetrievedChunk[]>;
}

export interface ChatPipelineInput {
  question: string;
  history: ChatHistoryEntry[];
}

/** Non-streaming run: build-prompt -> invoke -> post-process. */
export async function runChat(
  input: ChatPipelineInput,
  deps: ChatPipelineDeps,
): Promise<ChatOutput> {
  const context = deps.retrieveContext ? await deps.retrieveContext(input.question) : [];
  const request = buildPrompt({ ...input, context }, deps.template);
  const result = await invoke(deps.provider, request);
  const processed = processModelOutput(result.content);

  const ai: AiMetadata = {
    modelId: result.modelId,
    promptVersion: deps.template.version,
    retrievedChunkIds: context.map((c) => c.id),
    confidence: processed.degraded ? null : processed.confidence,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    latencyMs: result.latencyMs,
  };

  return {
    answer: processed.answer,
    confidence: processed.degraded ? null : processed.confidence,
    citations: processed.citations,
    ai,
  };
}

export type ChatStreamEvent =
  | { type: "status"; status: "thinking" }
  | { type: "delta"; text: string }
  | { type: "done"; output: ChatOutput }
  | { type: "error"; message: string };

/** Streaming variant: same 3 stages, deltas forwarded as they arrive. */
export async function* runChatStream(
  input: ChatPipelineInput,
  deps: ChatPipelineDeps,
): AsyncGenerator<ChatStreamEvent> {
  yield { type: "status", status: "thinking" };

  let context: RetrievedChunk[] = [];
  try {
    context = deps.retrieveContext ? await deps.retrieveContext(input.question) : [];
  } catch {
    context = [];
  }

  const request = buildPrompt({ ...input, context }, deps.template);
  const startedAt = Date.now();
  let finalContent = "";
  let modelId = deps.provider.name;
  let usage = { promptTokens: 0, completionTokens: 0 };
  let failed = false;

  for await (const event of deps.provider.stream(request)) {
    if (event.type === "delta") {
      finalContent += event.text;
      yield { type: "delta", text: event.text };
    } else if (event.type === "done") {
      finalContent = event.result.content || finalContent;
      modelId = event.result.modelId;
      usage = event.result.usage;
    } else {
      failed = true;
      yield { type: "error", message: event.message };
    }
  }

  if (failed) return;

  const processed = processModelOutput(finalContent);
  const output: ChatOutput = {
    answer: processed.answer,
    confidence: processed.degraded ? null : processed.confidence,
    citations: processed.citations,
    ai: {
      modelId,
      promptVersion: deps.template.version,
      retrievedChunkIds: context.map((c) => c.id),
      confidence: processed.degraded ? null : processed.confidence,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      latencyMs: Date.now() - startedAt,
    },
  };
  yield { type: "done", output };
}

export type { LlmStreamEvent };
