import type { LlmMessage, LlmRequest } from "../../domain/ports.js";
import type { ChatHistoryEntry, RetrievedChunk } from "../../domain/types.js";
import type { PromptTemplate } from "../prompts/qa.v1.js";

const MAX_HISTORY_TURNS = 6;
const MAX_QUESTION_CHARS = 4_000;

export interface BuildPromptInput {
  question: string;
  history: ChatHistoryEntry[];
  context: RetrievedChunk[];
}

/**
 * Stage 1/3 — prompt construction. Pure function: template + input in,
 * LlmRequest out. No I/O, no SDK calls (AGENTS.md #1).
 */
export function buildPrompt(
  input: BuildPromptInput,
  template: PromptTemplate,
): LlmRequest {
  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  if (question.length === 0) {
    throw new Error("Question must not be empty");
  }
  /* LLMs have a strict memory limit (context window) and charge for each input token.
   Here, I apply `slice(-MAX_HISTORY_TURNS)` to retain only the last 6 interactions, discarding the distant past.
  Then, I use `.map` to extract strictly the `role` and `content`. */

  const history: LlmMessage[] = input.history
    .slice(-MAX_HISTORY_TURNS)
    .map((entry) => ({ role: entry.role, content: entry.content }));

  /**
   * Assembles standard message hierarchy (System -> History -> User + RAG Context).
   * Enforces strict RAG guardrails: temp 0.2 for analytical precision and
   * maxTokens 1024 to prevent infinite generation and control costs.
   */
  return {
    messages: [
      { role: "system", content: template.system },
      ...history,
      {
        role: "user",
        content: template.buildUser({ question, context: input.context }),
      },
    ],
    temperature: 0.2, // Temperature controls the model's "creativity" or randomness (ranging from 0.0 to 2.0).
    maxTokens: 1024, // It is the strict limit on words/fragments (tokens) that the model is permitted to generate as a response.
  };
}
