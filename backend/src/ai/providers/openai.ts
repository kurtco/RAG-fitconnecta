import OpenAI from "openai";
import type {
  LlmRequest,
  LlmResult,
  LlmStreamEvent,
  LLMProvider,
} from "../../domain/ports.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/**
 * OpenAI adapter (gpt-4o-mini by default). The OpenAI SDK is confined to
 * this file: everything else talks to the LLMProvider port (AGENTS.md #2/#3).
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 30_000,
      maxRetries: 1,
    });
    this.model = options.model;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1024,
    });
    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? "",
      modelId: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    let content = "";
    let usage = { promptTokens: 0, completionTokens: 0 };
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 1024,
        stream: true,
        stream_options: { include_usage: true },
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          yield { type: "delta", text: delta };
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
      }
      yield {
        type: "done",
        result: { content, modelId: this.model, usage },
      };
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "LLM stream failed",
      };
    }
  }
}
