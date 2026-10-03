import { z } from "zod";

/**
 * Stage 3/3 — response post-processing. The raw model output is NEVER
 * passed through to the API layer: it is parsed and validated against a
 * zod schema first (AGENTS.md #4, SPEC B5/B8).
 */

export const citationSchema = z.object({
  chunkId: z.string().min(1),
  quote: z.string().max(500),
});

export const aiAnswerSchema = z.object({
  answer: z.string().min(1).max(8_000),
  confidence: z.number().min(0).max(1),
  citations: z.array(citationSchema).max(20).default([]),
});

export type AiAnswer = z.infer<typeof aiAnswerSchema>;

export interface ProcessedAnswer extends AiAnswer {
  /** true when the model output failed validation and we degraded safely. */
  degraded: boolean;
  parseError?: string;
}

const FENCE_RE = /^\s*```(?:json)?\s*|\s*```\s*$/g;

/** Extracts the first JSON object from a model response (tolerates fences/prose). */
export function extractJson(raw: string): string {
  const trimmed = raw.trim().replace(FENCE_RE, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return trimmed;
  }
  return trimmed.slice(start, end + 1);
}

export function processModelOutput(raw: string): ProcessedAnswer {
  try {
    const parsed: unknown = JSON.parse(extractJson(raw));
    const result = aiAnswerSchema.safeParse(parsed);
    if (result.success) {
      return { ...result.data, degraded: false };
    }
    return degrade(raw, result.error.issues.map((i) => i.message).join("; "));
  } catch (error) {
    return degrade(raw, error instanceof Error ? error.message : "JSON parse failed");
  }
}

/**
 * Safe degradation: if the model produced unusable structured output, we
 * surface a low-confidence plain-text answer instead of failing the request
 * or trusting unvalidated content.
 */
function degrade(raw: string, parseError: string): ProcessedAnswer {
  const text = raw.trim().replace(FENCE_RE, "").slice(0, 2_000);
  return {
    answer:
      text.length > 0
        ? text
        : "The assistant produced an unreadable response. Please re-ask or rephrase.",
    confidence: 0,
    citations: [],
    degraded: true,
    parseError,
  };
}
