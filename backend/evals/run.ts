/**
 * Evaluation runner (SPEC D4 / Part 2.2).
 *
 * Runs the golden set through the real pipeline (chunk -> embed -> retrieve
 * -> runChat) with an in-memory vector store, measuring:
 *   - correctness   (content assertions; meaningful with a real LLM only)
 *   - groundedness  (retrieval found context / not-grounded path taken)
 *   - latency       (p50/p95 per case)
 *   - cost          (token usage priced with current gpt-4o-mini rates)
 *
 * Regression detection: compares aggregate metrics against evals/baseline.json
 * and exits non-zero when pass rate drops or latency regresses badly.
 * CI integration = run this on every prompt/model change.
 *
 * Usage:
 *   npm run evals                     # uses LLM_PROVIDER from env
 *   npm run evals -- --provider mock  # plumbing-only mode, no API key
 *   npm run evals -- --update-baseline
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chunkText } from "../src/rag/chunk.js";
import { createEmbeddingProvider, MockEmbeddingProvider } from "../src/rag/embed.js";
import { retrieveChunks } from "../src/rag/retrieve.js";
import { createLLMProvider } from "../src/ai/providers/factory.js";
import { getPromptTemplate } from "../src/ai/prompts/registry.js";
import { runChat } from "../src/ai/pipeline/chat.js";
import type { ChunkInsert, ChunkRepository } from "../src/domain/ports.js";
import type { RetrievedChunk } from "../src/domain/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// USD per 1M tokens (Oct 2026 public pricing)
const PRICING = { chatInputPerM: 0.15, chatOutputPerM: 0.6, embeddingPerM: 0.02 };

interface GoldenCase {
  id: string;
  question: string;
  expectGrounded: boolean;
  mustContain?: string[];
  mustContainAny?: string[][];
  mustNotContain?: string[];
  maxLatencyMs: number;
}

interface Golden {
  fixture: { filename: string; content: string };
  cases: GoldenCase[];
}

interface CaseResult {
  id: string;
  pass: boolean;
  grounded: boolean;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  failures: string[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot; // vectors stored normalized
}

function inMemoryChunkStore(): ChunkRepository & { rows: (ChunkInsert & { embedding: number[] })[] } {
  const rows: (ChunkInsert & { embedding: number[] })[] = [];
  return {
    rows,
    insertMany: async (chunks) => {
      rows.push(...chunks);
    },
    searchSimilar: async (
      _ownerId: string,
      queryEmbedding: number[],
      topK: number,
    ): Promise<RetrievedChunk[]> => {
      return rows
        .map((row, i) => ({
          id: `mem-${i}`,
          documentId: row.documentId,
          chunkIndex: row.chunkIndex,
          content: row.content,
          tokenEst: row.tokenEst,
          score: cosine(queryEmbedding, row.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const providerArg = args.find((a) => a.startsWith("--provider"))?.split("=")[1]
    ?? (args.includes("--provider") ? args[args.indexOf("--provider") + 1] : undefined);
  const provider = (providerArg ?? process.env.LLM_PROVIDER ?? "mock") as "openai" | "mock";
  const updateBaseline = args.includes("--update-baseline");

  const golden: Golden = JSON.parse(
    readFileSync(path.join(__dirname, "golden.json"), "utf8"),
  );

  const apiKey = process.env.OPENAI_API_KEY;
  if (provider === "openai" && !apiKey) {
    console.error("OPENAI_API_KEY is required for --provider openai");
    process.exit(2);
  }

  // Embeddings: real when running against openai, deterministic mock otherwise.
  const embeddings =
    provider === "openai" && apiKey
      ? createEmbeddingProvider({
          provider: "openai",
          openaiApiKey: apiKey,
          openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        })
      : new MockEmbeddingProvider();

  const llm = createLLMProvider({
    provider,
    openaiApiKey: apiKey,
    openaiChatModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
  });
  const template = getPromptTemplate(process.env.PROMPT_VERSION ?? "v1");

  // Ingest fixture through the real chunker + embedder.
  const store = inMemoryChunkStore();
  const chunks = chunkText(golden.fixture.content, {
    chunkTokens: Number(process.env.RAG_CHUNK_TOKENS ?? 500),
    overlapTokens: Number(process.env.RAG_CHUNK_OVERLAP ?? 50),
  });
  const vectors = await embeddings.embed(chunks.map((c) => c.content));
  await store.insertMany(
    chunks.map((c, i) => ({
      documentId: "fixture-doc",
      chunkIndex: c.chunkIndex,
      content: c.content,
      tokenEst: c.tokenEst,
      embedding: vectors[i] ?? [],
    })),
  );
  const embedTokens = Math.ceil(
    chunks.reduce((sum, c) => sum + c.content.length, 0) / 1000 / 4,
  ); // rough: embeddings priced per 1M input tokens

  console.log(`\nEvals: provider=${provider} prompt=${template.version} chunks=${chunks.length}\n`);

  const results: CaseResult[] = [];
  for (const testCase of golden.cases) {
    const startedAt = Date.now();
    const output = await runChat(
      { question: testCase.question, history: [], ownerId: "eval-user" },
      {
        provider: llm,
        template,
        retrieveContext: (question) =>
          retrieveChunks({ embeddings, chunks: store }, "eval-user", question, {
            topK: Number(process.env.RAG_TOP_K ?? 5),
            // Lexical mock embeddings dilute cosine on long chunks (question
            // stems vs ~200-token chunk); true negatives stay at exactly 0,
            // so a low threshold keeps them ungrounded while real-overlap
            // cases pass. Real embeddings use the configured threshold.
            minScore: provider === "mock" ? 0.05 : Number(process.env.RAG_MIN_SCORE ?? 0.2),
          }),
      },
    );
    const latencyMs = Date.now() - startedAt;

    const grounded = output.ai.retrievedChunkIds.length > 0;
    const failures: string[] = [];
    const answerLower = output.answer.toLowerCase();

    if (grounded !== testCase.expectGrounded) {
      failures.push(`groundedness: expected ${testCase.expectGrounded}, got ${grounded}`);
    }
    if (latencyMs > testCase.maxLatencyMs) {
      failures.push(`latency ${latencyMs}ms > max ${testCase.maxLatencyMs}ms`);
    }

    // Content assertions only with a real provider (mock answers are synthetic).
    if (provider === "openai") {
      for (const needle of testCase.mustContain ?? []) {
        if (!output.answer.includes(needle)) failures.push(`missing "${needle}"`);
      }
      for (const group of testCase.mustContainAny ?? []) {
        if (!group.some((needle) => answerLower.includes(needle.toLowerCase()))) {
          failures.push(`missing any of [${group.join(" | ")}]`);
        }
      }
      for (const needle of testCase.mustNotContain ?? []) {
        if (answerLower.includes(needle.toLowerCase())) failures.push(`contains forbidden "${needle}"`);
      }
    }

    results.push({
      id: testCase.id,
      pass: failures.length === 0,
      grounded,
      latencyMs,
      promptTokens: output.ai.promptTokens,
      completionTokens: output.ai.completionTokens,
      failures,
    });
    const status = failures.length === 0 ? "PASS" : "FAIL";
    console.log(
      `  [${status}] ${testCase.id.padEnd(16)} grounded=${grounded ? "y" : "n"} ${String(latencyMs).padStart(6)}ms  tokens=${output.ai.promptTokens}+${output.ai.completionTokens}`,
    );
    for (const failure of failures) console.log(`         ↳ ${failure}`);
  }

  const totalPromptTokens = results.reduce((s, r) => s + r.promptTokens, 0);
  const totalCompletionTokens = results.reduce((s, r) => s + r.completionTokens, 0);
  const costUsd =
    (totalPromptTokens / 1e6) * PRICING.chatInputPerM +
    (totalCompletionTokens / 1e6) * PRICING.chatOutputPerM +
    (embedTokens / 1e6) * PRICING.embeddingPerM;

  const summary = {
    provider,
    promptVersion: template.version,
    timestamp: new Date().toISOString(),
    totalCases: results.length,
    passed: results.filter((r) => r.pass).length,
    passRate: Number((results.filter((r) => r.pass).length / results.length).toFixed(3)),
    groundednessRate: Number(
      (results.filter((r) => r.grounded).length / results.length).toFixed(3),
    ),
    latencyP50Ms: Math.round(percentile(results.map((r) => r.latencyMs), 50)),
    latencyP95Ms: Math.round(percentile(results.map((r) => r.latencyMs), 95)),
    totalTokens: totalPromptTokens + totalCompletionTokens,
    estimatedCostUsd: Number(costUsd.toFixed(4)),
    results,
  };

  writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(summary, null, 2));
  console.log(
    `\nSummary: ${summary.passed}/${summary.totalCases} pass (${(summary.passRate * 100).toFixed(1)}%) · p50=${summary.latencyP50Ms}ms p95=${summary.latencyP95Ms}ms · tokens=${summary.totalTokens} · cost=$${summary.estimatedCostUsd}`,
  );

  // --- Baseline comparison (regression gate) ---
  const baselinePath = path.join(__dirname, "baseline.json");
  if (updateBaseline) {
    const { timestamp: _t, results: _r, ...aggregate } = summary;
    writeFileSync(baselinePath, JSON.stringify(aggregate, null, 2));
    console.log(`Baseline updated at ${baselinePath}`);
    return;
  }

  if (existsSync(baselinePath) && provider === "openai") {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as typeof summary;
    const regressions: string[] = [];
    if (summary.passRate < baseline.passRate - 0.05) {
      regressions.push(
        `pass rate dropped: ${summary.passRate} < baseline ${baseline.passRate} (tolerance 0.05)`,
      );
    }
    if (summary.latencyP95Ms > baseline.latencyP95Ms * 1.5 + 1000) {
      regressions.push(
        `p95 latency regressed: ${summary.latencyP95Ms}ms vs baseline ${baseline.latencyP95Ms}ms`,
      );
    }
    if (regressions.length > 0) {
      console.error("\nREGRESSION DETECTED:");
      for (const r of regressions) console.error(`  - ${r}`);
      process.exitCode = 1;
      return;
    }
    console.log("No regressions vs baseline.");
  } else if (provider === "mock") {
    console.log("(baseline comparison skipped in mock mode)");
  }
}

main().catch((error) => {
  console.error("Eval run failed:", error);
  process.exit(2);
});
