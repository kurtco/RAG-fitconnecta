import { describe, expect, it } from "vitest";
import {
  assertSupportedFile,
  DocumentParseError,
  parseDocument,
  UnsupportedDocumentError,
} from "../src/rag/parse.js";
import { chunkText, estimateTokens } from "../src/rag/chunk.js";
import { MockEmbeddingProvider } from "../src/rag/embed.js";

const options = { maxBytes: 10 * 1024 * 1024 };

describe("rag/parse", () => {
  it("extracts text from a TXT buffer and normalizes whitespace", async () => {
    const parsed = await parseDocument(Buffer.from("Hello\r\n\r\n\n\nWorld\u0000!"), "text/plain");
    expect(parsed.text).toBe("Hello\n\nWorld!");
    expect(parsed.charCount).toBe(parsed.text.length);
  });

  it("rejects empty documents", async () => {
    await expect(parseDocument(Buffer.from("   \n\n  "), "text/plain")).rejects.toThrow(
      DocumentParseError,
    );
  });

  it("rejects unsupported mime types and extensions", () => {
    expect(() => assertSupportedFile("application/zip", "a.zip", 10, options)).toThrow(
      UnsupportedDocumentError,
    );
    // Mime spoofing: extension must match too
    expect(() => assertSupportedFile("text/plain", "evil.exe", 10, options)).toThrow(
      UnsupportedDocumentError,
    );
  });

  it("rejects empty and oversized files", () => {
    expect(() => assertSupportedFile("text/plain", "a.txt", 0, options)).toThrow(DocumentParseError);
    expect(() =>
      assertSupportedFile("text/plain", "a.txt", 11 * 1024 * 1024, options),
    ).toThrow(DocumentParseError);
  });

  it("accepts pdf by mime + extension", () => {
    expect(() => assertSupportedFile("application/pdf", "report.pdf", 1024, options)).not.toThrow();
  });
});

describe("rag/chunk", () => {
  const paragraph = (sentences: number, marker: string) =>
    Array.from({ length: sentences }, (_, i) => `${marker} sentence number ${i} with some padding words.`).join(" ");

  it("produces sequential chunks within the token budget", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(6, `P${i}`)).join("\n\n");
    const chunks = chunkText(text, { chunkTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((c, i) => {
      expect(c.chunkIndex).toBe(i);
      expect(c.tokenEst).toBe(estimateTokens(c.content));
      expect(c.tokenEst).toBeLessThanOrEqual(160); // budget + unit overshoot tolerance
    });
  });

  it("keeps overlap between consecutive chunks", () => {
    // Small paragraphs so each chunk holds several units and overlap applies.
    const text = Array.from({ length: 30 }, (_, i) => paragraph(2, `X${i}`)).join("\n\n");
    const chunks = chunkText(text, { chunkTokens: 80, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 0; i < chunks.length - 1; i++) {
      const lastUnitOfCurrent = chunks[i]!.content.split("\n\n").pop()!;
      expect(chunks[i + 1]!.content.startsWith(lastUnitOfCurrent)).toBe(true);
    }
  });

  it("hard-splits a giant single sentence", () => {
    const text = "word ".repeat(2_000).trim();
    const chunks = chunkText(text, { chunkTokens: 100, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c) => expect(c.tokenEst).toBeLessThanOrEqual(120));
  });

  it("returns no chunks for whitespace-only input", () => {
    expect(chunkText("   \n\n  ", { chunkTokens: 100, overlapTokens: 10 })).toEqual([]);
  });
});

describe("rag/embed (mock provider)", () => {
  it("is deterministic and normalized to unit length", async () => {
    const provider = new MockEmbeddingProvider();
    const [a1, a2, b] = await provider.embed(["same text", "Same   TEXT", "other text"]);
    expect(a1).toEqual(a2); // case/whitespace insensitive
    expect(a1).not.toEqual(b);
    const norm = Math.sqrt(a1!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(a1).toHaveLength(1536);
  });

  it("identical text has cosine 1, different text near 0", async () => {
    const provider = new MockEmbeddingProvider();
    const [a, b] = await provider.embed(["revenue report", "banana smoothie recipe"]);
    const dot = a!.reduce((s, x, i) => s + x * b![i]!, 0);
    expect(dot).toBeLessThan(0.1);
  });

  it("texts sharing vocabulary have proportional similarity (lexical mock)", async () => {
    const provider = new MockEmbeddingProvider();
    const [a, b, c] = await provider.embed([
      "total revenue in Q3 2026",
      "total revenue for Q3 2026 increased",
      "banana smoothie recipe",
    ]);
    const overlap = a!.reduce((s, x, i) => s + x * b![i]!, 0);
    const unrelated = a!.reduce((s, x, i) => s + x * c![i]!, 0);
    expect(overlap).toBeGreaterThan(0.5);
    expect(unrelated).toBeLessThan(0.15);
    expect(overlap).toBeGreaterThan(unrelated);
  });

  it("handles empty input", async () => {
    expect(await new MockEmbeddingProvider().embed([])).toEqual([]);
  });
});
