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
  /** Phase 2 injects pgvector retrieval here, scoped to the requesting user. */
  retrieveContext?: (question: string, ownerId?: string) => Promise<RetrievedChunk[]>;
}

export interface ChatPipelineInput {
  question: string;
  history: ChatHistoryEntry[];
  ownerId?: string;
}

/**
 * When retrieval is wired but nothing scored above the threshold, we answer
 * with a structured "not grounded" response WITHOUT calling the LLM:
 * prevents hallucination (SPEC F7) and saves tokens (SPEC B9).
 */
function notGroundedOutput(deps: ChatPipelineDeps): ChatOutput {
  return {
    answer:
      "The uploaded documents do not contain information to answer this question. Try rephrasing, or upload a document that covers the topic.",
    confidence: 0.05,
    citations: [],
    ai: {
      modelId: `none:${deps.provider.name}`,
      promptVersion: deps.template.version,
      retrievedChunkIds: [],
      confidence: 0.05,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
    },
  };
}

/** Non-streaming run: build-prompt -> invoke -> post-process. */
export async function runChat(
  input: ChatPipelineInput,
  deps: ChatPipelineDeps,
): Promise<ChatOutput> {
  let context: RetrievedChunk[] = [];
  if (deps.retrieveContext) {
    context = await deps.retrieveContext(input.question, input.ownerId);
    if (context.length === 0) {
      return notGroundedOutput(deps);
    }
  }
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
    context = deps.retrieveContext
      ? await deps.retrieveContext(input.question, input.ownerId)
      : [];
  } catch {
    context = [];
  }

  if (deps.retrieveContext && context.length === 0) {
    yield { type: "done", output: notGroundedOutput(deps) };
    return;
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
