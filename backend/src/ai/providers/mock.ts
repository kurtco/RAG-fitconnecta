import type {
  LlmRequest,
  LlmResult,
  LlmStreamEvent,
  LLMProvider,
} from "../../domain/ports.js";

const MODEL_ID = "mock-llm-v1";

/**
 * Deterministic provider used for tests and no-API-key demos (SPEC B6).
 * Emits a schema-valid JSON answer so the whole pipeline (including
 * post-processing validation) is exercised without network calls.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async complete(request: LlmRequest): Promise<LlmResult> {
    const content = this.buildAnswer(request);
    return {
      content,
      modelId: MODEL_ID,
      usage: {
        promptTokens: estimateTokens(JSON.stringify(request.messages)),
        completionTokens: estimateTokens(content),
      },
    };
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const result = await this.complete(request);
    const chunkSize = 24;
    for (let i = 0; i < result.content.length; i += chunkSize) {
      yield { type: "delta", text: result.content.slice(i, i + chunkSize) };
      await sleep(5);
    }
    yield { type: "done", result };
  }

  private buildAnswer(request: LlmRequest): string {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    const question = (lastUser?.content ?? "").split("User question:").pop()?.trim() ?? "";
    const payload = {
      answer: `[mock] Grounded answer to: "${question.slice(0, 200)}" (no LLM was called)`,
      confidence: 0.42,
      citations: [],
    };
    return JSON.stringify(payload);
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
