import { describe, expect, it } from "vitest";
import { getPromptTemplate, listPromptVersions } from "../src/ai/prompts/registry.js";
import type { RetrievedChunk } from "../src/domain/types.js";

const chunk: RetrievedChunk = {
  id: "chunk-1",
  documentId: "doc-1",
  chunkIndex: 0,
  content: "Q3 revenue was 1.2M USD.",
  tokenEst: 10,
  score: 0.87,
  filename: "report.txt",
};

describe("prompt registry (SPEC B7)", () => {
  it("lists available versions", () => {
    expect(listPromptVersions()).toEqual(expect.arrayContaining(["v1", "v2"]));
  });

  it("returns v1 and v2 templates", () => {
    expect(getPromptTemplate("v1").version).toBe("v1");
    expect(getPromptTemplate("v2").version).toBe("v2");
  });

  it("throws on unknown version", () => {
    expect(() => getPromptTemplate("v99")).toThrow(/Unknown prompt version/);
  });
});

describe("prompt templates (SPEC B8 injection defense)", () => {
  it.each(["v1", "v2"])("%s system prompt marks context as untrusted data", (version) => {
    const template = getPromptTemplate(version);
    expect(template.system).toMatch(/untrusted/i);
    expect(template.system).toMatch(/never|ignore|do not follow|not an instruction/i);
  });

  it("fences retrieved chunks with ids and scores", () => {
    const user = getPromptTemplate("v1").buildUser({ question: "Revenue?", context: [chunk] });
    expect(user).toContain('<chunk id="chunk-1"');
    expect(user).toContain("Q3 revenue was 1.2M USD.");
    expect(user).toContain("<untrusted_context>");
  });

  it("renders explicit empty context", () => {
    const user = getPromptTemplate("v1").buildUser({ question: "Hi?", context: [] });
    expect(user).toContain("no documents available");
  });

  it("requires JSON-only output instructions", () => {
    expect(getPromptTemplate("v1").outputInstructions).toMatch(/JSON/);
  });
});
