import { describe, expect, it } from "vitest";
import { runChat, runChatStream } from "../src/ai/pipeline/chat.js";
import { MockProvider } from "../src/ai/providers/mock.js";
import { getPromptTemplate } from "../src/ai/prompts/registry.js";
import type { ChatPipelineDeps } from "../src/ai/pipeline/chat.js";
import type { RetrievedChunk } from "../src/domain/types.js";

const deps: ChatPipelineDeps = {
  provider: new MockProvider(),
  template: getPromptTemplate("v1"),
};

const chunk: RetrievedChunk = {
  id: "chunk-42",
  documentId: "doc-1",
  chunkIndex: 0,
  content: "Policy X covers Y.",
  tokenEst: 6,
  score: 0.91,
};

describe("runChat pipeline (SPEC B5)", () => {
  it("returns validated output with AI traceability metadata", async () => {
    const output = await runChat({ question: "What does policy X cover?", history: [] }, deps);
    expect(output.answer).toContain("What does policy X cover?");
    expect(output.confidence).toBeCloseTo(0.42);
    expect(output.ai.modelId).toBe("mock-llm-v1");
    expect(output.ai.promptVersion).toBe("v1");
    expect(output.ai.latencyMs).toBeGreaterThanOrEqual(0);
    expect(output.ai.promptTokens).toBeGreaterThan(0);
  });

  it("records retrieved chunk ids in metadata", async () => {
    const withRetrieval: ChatPipelineDeps = {
      ...deps,
      retrieveContext: async () => [chunk],
    };
    const output = await runChat({ question: "q?", history: [] }, withRetrieval);
    expect(output.ai.retrievedChunkIds).toEqual(["chunk-42"]);
  });

  it("propagates retrieval failure as empty context, not a crash", async () => {
    const failing: ChatPipelineDeps = {
      ...deps,
      retrieveContext: async () => {
        throw new Error("vector store down");
      },
    };
    // runChat (non-stream) surfaces retrieval errors via runChatStream guard;
    // here we assert the stream variant degrades gracefully.
    const events = [];
    for await (const e of runChatStream({ question: "q?", history: [] }, failing)) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

describe("runChatStream pipeline (bonus X1)", () => {
  it("emits thinking -> deltas -> done", async () => {
    const types: string[] = [];
    let finalAnswer = "";
    for await (const event of runChatStream({ question: "stream test?", history: [] }, deps)) {
      types.push(event.type);
      if (event.type === "done") finalAnswer = event.output.answer;
    }
    expect(types[0]).toBe("status");
    expect(types.filter((t) => t === "delta").length).toBeGreaterThan(1);
    expect(types[types.length - 1]).toBe("done");
    expect(finalAnswer).toContain("stream test?");
  });
});
