# PLAN — Execution Phases

> Deadline: **Wednesday, Oct 7**. Budget: ~9–10h.
> Coding phases are executed by sessions using `opencode-go/-k2.7-code`; planning/docs/review by `opencode-go/qwen3.8-max`.
> **Rules for agents:** read `AGENTS.md` first; after finishing a task, check its box here and commit.

## Phase 0 — Setup & planning artifacts ✅

- [x] Repo structure created (monorepo: `backend/ frontend/ infra/`)
- [x] `SPEC.md` — traceable requirements checklist
- [x] `PLAN.md` — this file
- [x] `AGENTS.md` — project constitution
- [x] `.gitignore`, `.env.example`
- [x] `docker-compose.yml` (PostgreSQL 16 + pgvector; backend/frontend services added in Phase 4)
- [x] `infra/db/init.sql` — full DB schema (users, documents, chunks + HNSW index, conversations, messages)
- [x] Backend scaffold (Express + TS, strict config, folder layout per SPEC §2)
- [x] Frontend scaffold (Vite + React + TS)
- [x] git init + initial commit
- [x] Verify: `docker compose up` → pgvector ready, schema applied

## Phase 1 — Backend core (~2.5h) · Owner: (executed by Qwen session)

- [x] `backend/src/domain/`: types (`Document`, `Chunk`, `Conversation`, `Message`) + ports (`LLMProvider`, repositories). No external imports.
- [x] `ai/providers/llm-provider.ts` — interface: `complete(request): Promise<LLMResult>` incl. streaming variant + usage metadata
- [x] `ai/providers/openai.ts` — adapter for `gpt-4o-mini` (chat completions + SSE stream)
- [x] `ai/providers/mock.ts` — deterministic adapter (echo/fixture-based; enables full UX without API key)
- [x] `ai/providers/factory.ts` — selects provider via `LLM_PROVIDER` env
- [x] `ai/prompts/` — `qa.v1.ts`, `qa.v2.ts` templates + `registry.ts`; active version via `PROMPT_VERSION` env; defensive system prompt (injection mitigation per SPEC B8)
- [x] `ai/pipeline/` — `build-prompt.ts` → `invoke.ts` → `post-process.ts` (zod validation of structured output: answer, citations, confidence)
- [x] `config.ts` — single env source (zod-parsed, fail fast)
- [x] `middleware/`: `auth.ts` (JWT verify), `rate-limit.ts`, `error-handler.ts` (no stack leaks)
- [x] `api/routes/auth.ts` — `POST /register`, `POST /login` (bcrypt)
- [x] `infra/` — pg pool + repositories (users, documents, conversations, messages)
- [x] `api/routes/chat.ts` — `POST /api/v1/chat` (JSON)
- [x] Unit tests: pipeline stages, provider factory, prompt registry, post-process validation (mock provider)
- [x] Commit per feature group (`feat: ...`)

## Phase 2 — RAG (~1.5h) · Owner: (executed by Qwen session)

- [x] `rag/parse.ts` — TXT + PDF text extraction (`pdf-parse`); reject unsupported/oversized files
- [x] `rag/chunk.ts` — paragraph-aware chunking ~500 tokens, 50-token overlap, chunk index + doc metadata
- [x] `rag/embed.ts` — `text-embedding-3-small` adapter behind `EmbeddingProvider` port (+ mock)
- [x] `rag/retrieve.ts` — pgvector cosine top-k, score threshold from config
- [x] `api/routes/documents.ts` — `POST /documents` (multipart upload → parse → chunk → embed → store), `GET /documents` (list + status)
- [x] Wire retrieval into chat pipeline: retrieved chunks → fenced untrusted context → citations in response
- [x] Low-confidence path: below threshold → structured "not grounded" answer (SPEC F7)
- [x] Integration test: ingest fixture doc → query → expect citation of correct chunk (mock embeddings)
- [x] Commit

## Phase 3 — Frontend (~2h) · Owner: (executed by Qwen session)

- [x] Router + 2 pages: `/` (Upload & Documents), `/chat` (Assistant)
- [x] Auth: simple login/register form, JWT in memory + refresh-safe storage, protected routes
- [x] Upload page: drag&drop/file form, upload progress, documents list w/ status, empty state
- [x] Chat page: question input, SSE streaming render ("thinking" → tokens → done), error state w/ retry
- [x] Citations UI: source chunks w/ scores, expandable
- [x] Refine/re-ask buttons on each answer (SPEC F6)
- [x] Low-confidence banner (SPEC F7)
- [x] Loading/error/empty states everywhere (SPEC F4)
- [x] Commit

## Phase 4 — Infra (~1h) · Owner: (executed by Qwen session)

- [x] `backend/Dockerfile` (multi-stage, non-root user) + `frontend/Dockerfile`
- [x] `docker-compose.yml` — add backend + frontend services, healthchecks, depends_on
- [x] `infra/terraform/` — VPC, ECS Fargate service + ALB, RDS Postgres, Secrets Manager (OpenAI key) w/ rotation Lambda, IAM least-privilege. `terraform validate` + `plan` clean (no apply)
- [x] `.env.example` finalized (all vars documented)
- [x] Commit

## Phase 5 — README + evals (~1h) · Owner: Qwen

- [ ] `evals/golden.json` — 10–15 Q&A pairs over fixture docs (expected chunk/answer traits)
- [ ] `evals/run.ts` — runs golden set against pipeline (mock or real), reports groundedness/latency/token cost, exit non-zero on regression vs baseline
- [ ] `README.md` — sections: Run locally · Architecture decisions · AI design choices (provider abstraction, prompt versioning, injection defense) · Data (PII, retention, logging, auditability) · Evaluation & reliability · Costs (1k/10k/100k table) · Infrastructure (keys, rotation, bursty scaling) · Trade-offs & known limitations · Production roadmap (queues, tool calling, multi-tenant, OIDC)
- [ ] Commit

## Phase 6 — Buffer / polish (Tue Oct 6) · Owner: both

- [ ] End-to-end pass with `docker compose up`: SPEC §5 acceptance criteria 1–8
- [ ] `npm run build` + `npm test` green in both packages
- [ ] Repo hygiene: no dead files, `.env` never committed (`git log` check), commit history clean
- [ ] Push to GitHub, make repo presentable (description, topics)
