import { describe, expect, it } from "vitest";
import { aiAnswerSchema, extractJson, processModelOutput } from "../src/ai/pipeline/post-process.js";

describe("post-process stage", () => {
  it("accepts a valid JSON answer", () => {
    const raw = JSON.stringify({
      answer: "The document states X.",
      confidence: 0.9,
      citations: [{ chunkId: "c-1", quote: "X" }],
    });
    const result = processModelOutput(raw);
    expect(result.degraded).toBe(false);
    expect(result.answer).toContain("The document states X.");
    expect(result.citations).toHaveLength(1);
    expect(aiAnswerSchema.safeParse(result).success).toBe(true);
  });

  it("strips markdown fences and surrounding prose", () => {
    const raw = 'Sure! Here you go:\n```json\n{"answer":"A","confidence":0.5,"citations":[]}\n```';
    const result = processModelOutput(raw);
    expect(result.degraded).toBe(false);
    expect(result.answer).toBe("A");
  });

  it("degrades safely on non-JSON output", () => {
    const result = processModelOutput("I cannot answer that as JSON, sorry.");
    expect(result.degraded).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.citations).toEqual([]);
    expect(result.parseError).toBeTruthy();
  });

  it("degrades safely on schema violations (confidence out of range)", () => {
    const raw = JSON.stringify({ answer: "A", confidence: 7, citations: [] });
    const result = processModelOutput(raw);
    expect(result.degraded).toBe(true);
  });

  it("rejects oversized answers via schema", () => {
    expect(aiAnswerSchema.safeParse({ answer: "x".repeat(9_000), confidence: 0.5 }).success).toBe(false);
  });

  it("extractJson finds embedded object", () => {
    expect(extractJson('noise {"a":1} noise')).toBe('{"a":1}');
  });
});
