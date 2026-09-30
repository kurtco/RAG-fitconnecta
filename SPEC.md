# SPEC — AI Document Assistant (FinConecta Assessment)

> Traceable specification for the Full Stack AI Engineer assessment.
> Every requirement from the assessment brief maps to an acceptance criterion and a location in the codebase.

## 1. Problem Statement & Chosen Use Case

**Use case (from the brief's examples):** *AI assistant that answers questions about uploaded documents.*

Users can:
- Upload documents (TXT / PDF)
- Chat with an AI assistant grounded in those documents (RAG)
- See structured outputs: answers with cited source chunks, similarity scores, model/prompt metadata, and an uncertainty notice when retrieval confidence is low

**Why this use case:** it naturally exercises the full AI stack (ingestion → embeddings → vector retrieval → grounded generation → structured output) and matches FinConecta's product agents (Tom, Mateo) that work over financial documents.

## 2. Architecture Overview

```
frontend (React + Vite)                backend (Node + Express + TS)
┌──────────────┐   JWT    ┌──────────────────────────────────────────┐
│ Upload page  │─────────▶│ api/routes (auth, documents, chat)       │
│ Chat page    │  SSE     │   └─ middleware: jwt, rate-limit, errors │
│ (streaming,  │◀─────────│ ai/pipeline: build-prompt → invoke →     │
│  cite, retry)│          │              post-process (zod)          │
└──────────────┘          │ ai/providers: LLMProvider interface      │
                          │   ├─ openai.ts   (gpt-4o-mini)           │
                          │   └─ mock.ts     (deterministic, tests)  │
                          │ ai/prompts: versioned templates (v1, v2) │
                          │ rag/: chunk → embed → retrieve (pgvector)│
                          └───────────────┬──────────────────────────┘
                                          │
                                 PostgreSQL 16 + pgvector (Docker)
```

**Ports & adapters:** `domain/` defines contracts (LLMProvider, repositories) with zero external imports. Adapters live in `ai/providers/` and `infra/`. Swapping OpenAI for another provider = implementing one interface (mirrors FinConecta's "LLM Switch").

## 3. Requirements Traceability Matrix

### Part 1.2 — Backend (AI-First)

| # | Requirement | How it is met | Location | Done |
|---|-------------|---------------|----------|------|
| B1 | REST API | Express REST endpoints, JSON, versioned under `/api/v1` | `backend/src/api/` | ☐ |
| B2 | One AI interaction endpoint (LLM call) | `POST /api/v1/chat` (+ SSE variant `POST /api/v1/chat/stream`) | `api/routes/chat.ts` | ☐ |
| B3 | Persistence layer | PostgreSQL 16 + pgvector via Docker | `infra/db/init.sql`, `backend/src/infra/` | ☐ |
| B4 | Authentication (JWT) | Register/login issue signed JWT; auth middleware protects all AI/document routes | `api/routes/auth.ts`, `middleware/auth.ts` | ☐ |
| B5 | Clear separation: prompt construction / model invocation / response post-processing | Explicit 3-stage pipeline; stages never mixed in one function | `ai/pipeline/` | ☐ |
| B6 | Ability to switch LLM providers | `LLMProvider` interface + `OpenAIProvider` + `MockProvider`; factory selects via `LLM_PROVIDER` env var | `ai/providers/` | ☐ |
| B7 | Basic prompt versioning / configuration | Named versioned templates (`qa.v1`, `qa.v2`), active version via config; version recorded in every response + persisted with messages | `ai/prompts/` | ☐ |
| B8 | Explain: prompt injection / unsafe input prevention | System prompt hardening, document context fenced + explicitly untrusted, output schema validation (zod), input size limits. Explained in README §Security | README | ☐ |
| B9 | Explain: cost control & rate limits in production | Per-user rate limiting implemented (express-rate-limit); cost table 1k/10k/100k requests + production strategies in README §Costs | README | ☐ |

### Part 1.3 — Frontend (AI-Aware UX)

| # | Requirement | How it is met | Location | Done |
|---|-------------|---------------|----------|------|
| F1 | ≥ 2 pages | `/` Upload & Documents · `/chat` Assistant | `frontend/src/pages/` | ☐ |
| F2 | Form to submit data to backend | Document upload form (TXT/PDF) + chat input | `frontend/src/` | ☐ |
| F3 | Display AI responses user-friendly | Markdown-ish rendering, cited sources with scores | `frontend/src/components/` | ☐ |
| F4 | Loading, error, empty states | All three states on every data view | components | ☐ |
| F5 | Model status (thinking / partial / errors) | SSE streaming: `thinking` → token deltas → `done`/`error` | Chat page | ☐ |
| F6 | Refine / re-ask | Re-ask button + editable follow-up on each answer | Chat page | ☐ |
| F7 | Handle hallucinations / uncertainty gracefully | Retrieval score below threshold → explicit low-confidence banner + "answer not grounded" fallback | Chat page | ☐ |

### Part 2 — Data & Architecture Thinking

| # | Requirement | How it is met | Done |
|---|-------------|---------------|------|
| D1 | What data stored vs not; retention of AI inputs/outputs | Stored: documents, chunks+embeddings, conversations, messages, prompt version, model id, token usage. Not stored: raw API keys, passwords (bcrypt hashed), no third-party analytics. Retention policy implemented as configurable TTL cleanup + explained in README §Data | ☐ |
| D2 | PII, logging, auditability | Logs redact document content & user emails; audit fields (created_by, timestamps) on all tables; every AI response traceable to prompt version + model + retrieved chunks. README §Data | ☐ |
| D3 | Bonus: vector store + embeddings + RAG | pgvector, `text-embedding-3-small`, paragraph chunking ~500 tokens w/ overlap, HNSW cosine index, top-k retrieval | ☐ |
| D4 | AI evaluation & reliability (markdown) | README §Evaluation: golden set (10–15 Q&A) in `evals/`, runnable script measuring groundedness/latency/cost; regression detection = run evals in CI on prompt/model change; production fallback for wrong answers | ☐ |

### Part 3 — Infrastructure & Deployment

| # | Requirement | How it is met | Done |
|---|-------------|---------------|------|
| I1 | Infrastructure definition (Terraform) | `infra/terraform/`: ECS Fargate + ALB, RDS Postgres, Secrets Manager, VPC. Definition only, not applied (documented) | ☐ |
| I2 | Secure secrets handling | Secrets Manager in Terraform; locally `.env` (gitignored) + `.env.example`; nothing hardcoded | ☐ |
| I3 | Config vs code separation | 12-factor: all config via env (`backend/src/config.ts` single source) | ☐ |
| I4 | Explain: where AI keys live, rotation, bursty scaling | README §Infrastructure: Secrets Manager + automatic rotation (Lambda), ECS autoscaling on request depth/CPU, queue-based burst absorption | ☐ |
| I5 | Dockerize backend (strong signal) | Multi-stage Dockerfile backend (+ frontend); `docker-compose.yml` runs full stack | ☐ |

### Bonus sections (chosen)

| # | Bonus | Decision | Done |
|---|-------|----------|------|
| X1 | Streaming AI responses | ✅ Implemented (SSE token-by-token) | ☐ |
| X2 | Cost estimation 1k/10k/100k requests | ✅ README §Costs with real gpt-4o-mini pricing | ☐ |
| X3 | Tool/function calling | ⛔ Out of scope (time budget) — design sketch in README | ☐ |
| X4 | Background async processing | ⛔ Not implemented — document ingestion is synchronous for simplicity; README explains production design (SQS + workers) | ☐ |
| X5 | Multi-tenant isolation | ⛔ Not implemented — README explains per-tenant data isolation design | ☐ |

## 4. Scope / Non-Scope

**In scope:** everything marked ✅ above; Node 22 + Express + TypeScript; React + Vite; PostgreSQL 16 + pgvector in Docker; OpenAI (`gpt-4o-mini`, `text-embedding-3-small`) + Mock provider; JWT auth; SSE streaming; Terraform definition.

**Out of scope (with justification, per brief's "free to simplify scope, but explain your choices"):**
- Kubernetes/Kafka/real AWS deployment — 6–10h budget; Terraform defines the target architecture without applying it
- Multi-tenancy, queues/workers, tool calling — designed in README, not implemented
- OAuth/SSO — JWT chosen per brief ("JWT or similar"); README notes OIDC path for production
- Heavy UI styling — brief states design quality is secondary to usability/clarity

## 5. Acceptance Criteria (Definition of Done — global)

1. `docker compose up` starts DB + backend + frontend; app usable end-to-end at `http://localhost:5173`
2. Upload a TXT and a PDF → both chunked, embedded, retrievable
3. Ask a question grounded in the docs → streamed answer with cited chunks + scores
4. Ask a question NOT in the docs → low-confidence handling, no fabricated answer
5. Kill the OpenAI key (use `LLM_PROVIDER=mock`) → identical UX with deterministic mock answers (proves provider abstraction)
6. All endpoints under auth; unauthenticated requests get 401
7. `npm run build` + `npm test` green in backend and frontend
8. README covers every "Explain" item of the brief
