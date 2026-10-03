import type { PromptTemplate } from "./qa.v1.js";
import { qaV1 } from "./qa.v1.js";
import { qaV2 } from "./qa.v2.js";

const registry = new Map<string, PromptTemplate>([
  [qaV1.version, qaV1],
  [qaV2.version, qaV2],
]);

export function getPromptTemplate(version: string): PromptTemplate {
  const template = registry.get(version);
  if (!template) {
    throw new Error(
      `Unknown prompt version "${version}". Available: ${[...registry.keys()].join(", ")}`,
    );
  }
  return template;
}

export function listPromptVersions(): string[] {
  return [...registry.keys()];
}
