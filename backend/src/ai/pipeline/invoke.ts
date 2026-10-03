import type { LlmRequest, LlmResult, LLMProvider } from "../../domain/ports.js";

export interface InvokeResult extends LlmResult {
  latencyMs: number;
}

/**
 * Stage 2/3 — model invocation. The only stage that touches a provider.
 * Adds latency measurement and normalizes provider failures.
 */
export async function invoke(provider: LLMProvider, request: LlmRequest): Promise<InvokeResult> {
  const startedAt = Date.now();
  try {
    const result = await provider.complete(request);
    return { ...result, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    throw new LlmInvocationError(message);
  }
}

export class LlmInvocationError extends Error {
  override name = "LlmInvocationError";
}
