# AGENTS.md — Project Constitution

Rules for any AI agent or human working on this repository.
**This file overrides the user's global AGENTS.md for this project.**
Full context: read `SPEC.md` (requirements) and `PLAN.md` (phases & status) before starting any task.

## Language

- All code, comments, commits, docs, and identifiers are in **English** (the assessment is evaluated in English).

## Non-negotiable principles

1. **Strict 3-stage AI pipeline.** Prompt construction, model invocation, and response post-processing live in separate modules (`backend/src/ai/pipeline/`). Never call an LLM SDK from a route handler.
2. **Ports & adapters.** `backend/src/domain/` contains only types and interfaces — zero imports from `infra/`, `ai/providers/`, or any npm SDK. External services are reached only through their port interface.
3. **Provider abstraction.** Every LLM call goes through `LLMProvider`; every embedding call through `EmbeddingProvider`. Adding a provider = implementing one interface + registering it in the factory. `MockProvider` must always work (tests & no-key demos).
4. **Validate all AI output.** LLM responses are parsed and validated with zod schemas in post-processing before reaching the API layer. Invalid output → structured error, never a raw passthrough.
5. **No secrets in code.** Configuration only via environment variables, parsed and validated once in `backend/src/config.ts`. `.env` is gitignored; `.env.example` documents every variable. Never log keys, passwords, or full document contents.
6. **Untrusted document content.** Retrieved/uploaded content is fenced inside a clearly delimited context block, and the system prompt instructs the model to treat it as data, never as instructions (prompt-injection defense, see SPEC B8).
7. **Prompt versioning.** Prompts are named, versioned templates in `ai/prompts/`. Every persisted AI message records: prompt version, model id, token usage, retrieved chunk ids.

## Conventions

- TypeScript `strict: true` everywhere; no `any` without a written justification in the PR/commit.
- Backend: Node 22 + Express; zod for schemas; `pg` (no ORM) for database access; vitest for tests.
- Frontend: React 18 + Vite + TypeScript; no UI framework (plain CSS, usability over beauty per brief).
- Endpoints: `/api/v1/...`, REST, JSON errors shaped `{ error: { code, message } }`.
- Naming: kebab-case files, camelCase functions, PascalCase types/classes.
- Commits: small, one concern each — `feat: ...`, `fix: ...`, `test: ...`, `chore: ...`, `docs: ...`.
- Update `PLAN.md` checkboxes immediately after finishing a task.

## Definition of done (per task)

1. `npm run build` passes (backend and/or frontend as touched)
2. Relevant tests added/updated and `npm test` passes
3. No new lint/type errors
4. Committed with a descriptive message
5. `PLAN.md` checkbox ticked

## Boundaries

- Stay inside the current PLAN.md phase unless instructed otherwise.
- Do not add dependencies not listed in SPEC/PLAN without flagging it first.
- Do not implement out-of-scope items (SPEC §4); they are README design notes only.
