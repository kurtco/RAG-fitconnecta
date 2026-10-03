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
export function buildPrompt(input: BuildPromptInput, template: PromptTemplate): LlmRequest {
  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  if (question.length === 0) {
    throw new Error("Question must not be empty");
  }

  const history: LlmMessage[] = input.history
    .slice(-MAX_HISTORY_TURNS)
    .map((entry) => ({ role: entry.role, content: entry.content }));

  return {
    messages: [
      { role: "system", content: template.system },
      ...history,
      { role: "user", content: template.buildUser({ question, context: input.context }) },
    ],
    temperature: 0.2,
    maxTokens: 1024,
  };
}
