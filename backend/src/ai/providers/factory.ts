import type { LLMProvider } from "../../domain/ports.js";
import { MockProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";

export interface ProviderFactoryInput {
  provider: "openai" | "mock";
  openaiApiKey?: string;
  openaiChatModel: string;
}

/**
 * Selects the LLM adapter from configuration (SPEC B6).
 * Adding a new provider = implement LLMProvider + register it here;
 * no route, pipeline or domain code changes required.
 */
export function createLLMProvider(input: ProviderFactoryInput): LLMProvider {
  switch (input.provider) {
    case "mock":
      return new MockProvider();
    case "openai": {
      if (!input.openaiApiKey) {
        throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
      }
      return new OpenAIProvider({
        apiKey: input.openaiApiKey,
        model: input.openaiChatModel,
      });
    }
    default: {
      const exhaustive: never = input.provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
