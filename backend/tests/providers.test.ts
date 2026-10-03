import { describe, expect, it } from "vitest";
import { createLLMProvider } from "../src/ai/providers/factory.js";
import { MockProvider } from "../src/ai/providers/mock.js";
import { aiAnswerSchema } from "../src/ai/pipeline/post-process.js";

const request = {
  messages: [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "User question: What is the revenue?" },
  ],
};

describe("provider factory (SPEC B6)", () => {
  it("defaults to mock without API key", () => {
    const provider = createLLMProvider({ provider: "mock", openaiChatModel: "gpt-4o-mini" });
    expect(provider.name).toBe("mock");
  });

  it("throws when openai selected without key", () => {
    expect(() =>
      createLLMProvider({ provider: "openai", openaiChatModel: "gpt-4o-mini" }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("creates openai adapter when key present", () => {
    const provider = createLLMProvider({
      provider: "openai",
      openaiApiKey: "sk-test",
      openaiChatModel: "gpt-4o-mini",
    });
    expect(provider.name).toBe("openai");
  });
});

describe("MockProvider", () => {
  it("complete() returns schema-valid JSON answer", async () => {
    const provider = new MockProvider();
    const result = await provider.complete(request);
    expect(result.modelId).toBe("mock-llm-v1");
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    const parsed = aiAnswerSchema.safeParse(JSON.parse(result.content));
    expect(parsed.success).toBe(true);
    expect(result.content).toContain("What is the revenue?");
  });

  it("stream() emits deltas then done with full content", async () => {
    const provider = new MockProvider();
    const deltas: string[] = [];
    let done: string | undefined;
    for await (const event of provider.stream(request)) {
      if (event.type === "delta") deltas.push(event.text);
      if (event.type === "done") done = event.result.content;
    }
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(done);
    expect(() => JSON.parse(done!)).not.toThrow();
  });
});
