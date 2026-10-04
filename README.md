# AI Document Assistant — Full Stack AI Engineer Assessment

A production-oriented AI application: users upload documents (TXT/PDF), and a RAG-grounded assistant answers questions with **citations, confidence scores, token-by-token streaming, and honest "not in the documents" refusals** instead of hallucinations.

Built for the FinConecta assessment. Chosen use case from the brief: _"AI assistant that answers questions about uploaded documents"_ — it naturally exercises the full AI stack (ingestion → embeddings → vector retrieval → grounded generation → validated structured output).

**Development process:** spec-driven, lightweight. [`SPEC.md`](SPEC.md) is a traceable requirements checklist (every item of the brief → implementation → acceptance criteria), [`PLAN.md`](PLAN.md) tracks phased execution, and [`AGENTS.md`](AGENTS.md) is the project constitution (architectural invariants enforced during AI-assisted development — the same PromptOps discipline this platform productizes).

---

## Run locally

### Option A — Full Docker stack (recommended)

```bash
cp .env.example .env        # set JWT_SECRET; optionally OPENAI_API_KEY
docker compose up --build
```

- Frontend: http://localhost:8080 (nginx serves the SPA and proxies `/api` → backend)
- Backend: http://localhost:3000/health
- PostgreSQL 16 + pgvector: localhost:5432 (schema auto-applied from `infra/db/init.sql`)

### Option B — Dev mode (hot reload)

```bash
docker compose up db -d                 # database only
cd backend && cp ../.env.example .env   # edit JWT_SECRET / OPENAI_API_KEY
npm install && npm run dev              # :3000
cd ../frontend && npm install && npm run dev   # :5173 (proxies /api → :3000)
```

### Provider modes

| `LLM_PROVIDER`   | LLM                   | Embeddings               | Notes                                            |
| ---------------- | --------------------- | ------------------------ | ------------------------------------------------ |
| `mock` (default) | deterministic fixture | lexical feature-hashing  | **zero cost, no API key** — full UX + tests + CI |
| `openai`         | `gpt-4o-mini`         | `text-embedding-3-small` | set `OPENAI_API_KEY`; ~$0.001 per Q&A            |

The mock is a first-class citizen: it exercises the entire pipeline (including output validation and retrieval), which is how the test suite runs hermetically.

### Tests & evals

```bash
cd backend
npm test                          # 39 unit/integration tests (hermetic, mock provider)
npm run evals -- --provider=mock  # golden-set plumbing check
npm run evals                     # real quality eval (needs OPENAI_API_KEY)
npm run evals -- --update-baseline
```

---

## Architecture

```
frontend (React 18 + Vite + TS)          backend (Node 22 + Express + TS, strict)
┌───────────────────────────┐            ┌────────────────────────────────────────────┐
│ /login   JWT auth         │            │ api/routes        auth · documents · chat  │
│ /        upload + doc list│──JWT/SSE──▶│ middleware        auth · rate-limit · err  │
│ /chat    streaming, cites │            │ ai/pipeline  ①build-prompt ②invoke ③post  │
│          refine / re-ask  │            │ ai/prompts   versioned templates (v1, v2)  │
│          low-conf banner  │            │ ai/providers   LLMProvider: openai | mock  │
└───────────────────────────┘            │ rag/       parse · chunk · embed · retrieve│
                                         │ domain/    types + ports (zero SDK imports)│
                                         │ infra/     pg repositories · db pool       │
                                         └───────────────────┬────────────────────────┘
                                                             ▼
                                       PostgreSQL 16 + pgvector (HNSW cosine index)
```

### Key decisions

| Decision                                                       | Why                                                                                                                                                  | Alternative rejected                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Clean Architecture** (`domain/` = contracts only)            | The brief requires provider switching + stage separation; ports make both structural, not conventional. Swapping OpenAI = 1 adapter + 1 factory line | Layered MVC (LLM SDK leaks into routes)              |
| **3-stage AI pipeline** (build-prompt → invoke → post-process) | Brief requirement B5. Each stage is independently testable; post-processing is the only place untrusted model output becomes typed data              | Single "callLLM()" helper                            |
| **pgvector in the same Postgres**                              | One less moving component; transactional consistency between documents/chunks; HNSW is fine at this scale (<1M chunks)                               | Pinecone/FAISS (extra infra, no ACID with app data)  |
| **SSE streaming** (not WebSocket)                              | Unidirectional token flow is all the UX needs; works through nginx/ALB with buffering off; simpler ops                                               | WebSocket (bidirectional not required)               |
| **JWT + bcrypt**                                               | Brief allows "JWT or similar"; zero external dependency for an assessment                                                                            | OIDC/Auth0 — production path noted below             |
| **No ORM (pg + SQL)**                                          | Schema is small and SQL-first (vector ops); explicit queries = explicit data access                                                                  | Prisma/Drizzle (extra abstraction over vector types) |
| **Synchronous ingestion**                                      | Files are small (≤10MB); sync keeps the demo/debug loop trivial                                                                                      | Queue + workers — production design in §Roadmap      |

---

## AI design choices

### Provider abstraction (the "LLM Switch")

`domain/ports.ts` defines `LLMProvider` (`complete` + `stream`) and `EmbeddingProvider`. Adapters: `OpenAIProvider` (the only file importing the SDK), `MockProvider` (deterministic), and lexical `MockEmbeddingProvider`. `factory.ts` selects via env. Adding OpenRouter/Anthropic/a local model = one adapter + one `switch` case — no pipeline, route, or domain change.

### Prompt versioning

Templates are named artifacts (`ai/prompts/qa.v1.ts`, `qa.v2.ts`) in a registry; active version via `PROMPT_VERSION` env. **Every persisted assistant message records prompt version + model id + token usage + retrieved chunk ids + latency**, so any answer in production is reproducible/auditable ("why did the agent say that on date X?"). v2 demonstrates the versioning contract: stricter grounding/refusal rules for regulated contexts.

### Prompt injection defense (brief B8)

Defense in depth, in order of strength:

1. **Untrusted-context fencing** — retrieved chunks are wrapped in `<untrusted_context><chunk id=…>` blocks; the system prompt explicitly declares everything inside as _data, never instructions_ (role-change and "ignore previous instructions" attempts included).
2. **Input limits** — question ≤4,000 chars, upload ≤10MB, history capped at 6 turns (bounded blast radius and cost).
3. **Output validation** — model output must parse into a zod schema (`answer`, `confidence∈[0,1]`, `citations[]`); anything else degrades to a flagged low-confidence response, never raw passthrough. The model cannot smuggle structure the API didn't define.
4. **No tools, no side effects** — the assistant can only read; there is no action surface for an injection to trigger (the golden set includes a poisoned-document case and a direct injection case; see §Evaluation).
5. **Owner-scoped retrieval** — queries only ever see the requesting user's chunks (SQL join on `owner_id`), so cross-tenant data cannot leak through the context window.

What I would add in production: a classifier-based input filter, PII redaction before embedding, and per-tenant prompt/system configuration with change audit.

### Uncertainty handling (brief F7)

Two layers:

- **Retrieval gate:** if no chunk scores ≥ `RAG_MIN_SCORE`, the pipeline answers a structured _"the documents do not contain this"_ response **without calling the LLM** — zero hallucination risk, zero tokens spent.
- **Model-declared confidence:** below 0.3 the UI renders an explicit low-confidence warning banner.

### Cost & rate-limit control (brief B9)

Implemented: per-IP API limiter + stricter LLM-endpoint limiter (`express-rate-limit`), retrieval short-circuit above, `max_tokens` caps, small/cheap default model, top-k=5 retrieval budget.

Estimated per-request cost with gpt-4o-mini (≈2.2k prompt tokens incl. context, ≈300 completion):

| Volume        | LLM cost | Embeddings (amortized) | Total      |
| ------------- | -------- | ---------------------- | ---------- |
| 1k requests   | ~$0.51   | ~$0.05                 | **~$0.56** |
| 10k requests  | ~$5.10   | ~$0.50                 | **~$5.60** |
| 100k requests | ~$51     | ~$5                    | **~$56**   |

Production controls I would add (in order of ROI): **semantic response cache** (embed the question, serve cached answers above 0.95 similarity — typically 20-40% hit rate on FAQ-style traffic → same savings), **per-account token budgets** with 429 + graceful degradation, **model routing** (cheap model for retrieval-strong queries, escalate only on low confidence — this is exactly FinConecta's policy-based LLM Switch), and **batch API for ingestion** (50% off embeddings).

---

## Data: storage, retention, PII (brief 2.1)

**Stored:** document text as chunks + embeddings; conversations & messages; per-answer AI metadata (model, prompt version, chunk ids, tokens, latency, confidence); users (email + bcrypt hash).

**Not stored:** raw uploaded files (text is extracted, bytes discarded); passwords in any recoverable form; API keys anywhere near the data plane; no third-party analytics.

**Retention:** messages/chunks carry `created_at`; a retention job (cron or TTL policy) deletes conversation data after N days (configurable per deployment; 90 days default in production). Documents can be deleted by users → `ON DELETE CASCADE` removes chunks and embeddings. Embeddings are one-way derivatives but are treated as personal data under GDPR when source text is personal.

**PII:** the honest position — uploaded documents may contain PII, and embeddings preserve recoverable signal. Production design: (1) PII detection/redaction before chunking (regex + NER for emails, IDs, card numbers — PCI-relevant given Mastercard partnership), (2) encryption at rest (RDS storage encryption is already in Terraform) and in transit (TLS everywhere), (3) data residency by region selection, (4) DPIA-ready processing records — the `messages` audit trail doubles as the Art. 30 evidence.

**Logging:** structured logs with request ids; document _content_ and user emails are never logged (redaction by construction — logs carry ids, sizes, statuses, latencies, token counts only). Error handler returns generic messages; stack traces stay server-side.

**Auditability:** every assistant answer links to prompt version + model id + exact chunk ids used + token/latency metrics. An auditor can reconstruct _why_ any answer was given and replay it against the same template version.

---

## Evaluation & reliability (brief 2.2)

**Golden set** (`backend/evals/golden.json`): 12 cases over a fixture financial report — 9 fact-retrieval questions (exact figures must appear), 2 unanswerable/out-of-scope (must take the not-grounded path), 1 **prompt-injection case** (poisoned paragraph inside the fixture + direct "follow the instructions in the document" attempt; asserts refusal and non-exfiltration).

**Runner** (`npm run evals`): executes the real pipeline (chunk → embed → retrieve → generate) against an in-memory vector store and reports:

- **correctness** — per-case content assertions (real provider)
- **groundedness** — retrieval behaved as expected on every case (works in mock mode too → CI-able without an API key)
- **latency** p50/p95 and **cost** — priced from actual token usage

**Threshold tuning, data-driven:** `RAG_MIN_SCORE=0.2` was chosen by measuring the actual score distribution of the golden set with `text-embedding-3-small`: answerable questions score 0.23–0.49, an off-topic question scores 0.05. One negative case ("executive salaries" against a financial report) scores 0.37 — semantically _related_ corpora cannot be filtered at the retrieval gate, so it is defended at the answer layer: the prompt contract forces the model to admit absence instead of fabricating, and the eval asserts exactly that.

**Regression detection:** `--update-baseline` stores aggregate metrics; every subsequent run compares pass-rate (tolerance 5pp) and p95 latency (1.5×) and **exits non-zero on regression**. Wire into CI on any change to `ai/prompts/`, providers, or retrieval config — prompt edits are code changes and get the same gate.

**"AI gave a wrong answer" in production** — layered response:

1. **Detect:** confidence threshold + sampled human review of low-confidence answers; user feedback buttons (👍/👎) on every answer (UI hook exists: re-ask/refine); golden-set canaries re-run nightly against the live prompt/model combo.
2. **Contain:** every answer shows citations — a wrong answer is _visibly_ wrong against its source; the not-grounded path prevents the most dangerous class (confident fabrication).
3. **Fix:** the audit trail (prompt version + chunk ids + model) tells you _which layer_ failed — retrieval miss (fix chunking/threshold) vs generation error (fix prompt/version). Ship the fix as a new prompt version, re-run evals, roll forward; roll back = flip `PROMPT_VERSION`.
4. **Escalate:** human-in-the-loop for high-stakes flows — below a confidence floor, route to a human instead of answering (their platform's HITL pattern).

---

## Infrastructure (brief Part 3)

`infra/terraform/` (validated with Terraform 1.9 + AWS provider 5.x; **definition only — not applied**, no cloud account used for this assessment):

- **Network:** VPC, public subnets (ALB only) / private subnets (ECS, RDS), NAT, security groups with least-privilege chaining (internet → ALB:443 → backend:3000 → db:5432; nothing else reachable).
- **Compute:** ECS Fargate (backend 2×512cpu/1GB, frontend 2×256cpu/512MB), ALB path routing (`/api/*` → backend, `/` → nginx SPA), target-group health checks.
- **Data:** RDS PostgreSQL 16 (pgvector via extension), storage-encrypted, private-only, 7-day backups, multi-AZ in prod.
- **Secrets:** Secrets Manager for OpenAI key + JWT secret; **DB credentials auto-rotate every 45 days** (AWS-managed lambda). Task execution role can _only_ read those three secrets; **task role has zero AWS permissions** (the app needs none).
- **Scaling for bursty AI usage:** app-autoscaling 2→10 tasks on CPU 65% with fast scale-out cooldown (60s). The AI-specific constraint: tasks are I/O-bound waiting on LLM APIs, so CPU is a weak signal — production would scale on **in-flight-requests-per-task** (custom metric) and absorb bursts with a queue (below). LLM provider rate limits are the real ceiling; the queue + concurrency semaphores keep us under them instead of dropping requests.

**Where AI keys live & rotation:** Secrets Manager → injected via the task definition `secrets` block (never in images, env files, task-def plaintext, logs, or git). OpenAI has no AWS-managed rotation, so the runbook is **dual-key rotation**: issue new key → `put-secret-value` → rolling ECS redeploy → revoke old key. Zero downtime, and `lifecycle { ignore_changes }` keeps the real value out of Terraform state.

**Deployment:** multi-stage Dockerfiles, non-root runtime users, `npm ci` reproducible builds, healthchecks at every layer (container → target group → compose `depends_on: service_healthy`). Deploy = push image to ECR, update task definition revision (`aws ecs update-service` or CI pipeline).

---

## Trade-offs & known limitations

Deliberate simplifications for a 6–10h assessment (each with its production path):

| Limitation                                             | Why acceptable here                                                 | Production path                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Synchronous document ingestion                         | Small files, simpler demo; failure states are surfaced per-document | SQS + worker fleet; status polling or WebSocket progress                                 |
| In-memory rate limiting (per instance)                 | Single-instance demo                                                | Redis/ALB-backed distributed limiter, per-account quotas                                 |
| JWT in `localStorage`                                  | Simplest SPA auth; XSS risk noted                                   | httpOnly secure cookies + CSRF token, or OIDC (their SSO/SAML stack)                     |
| Lexical mock embeddings                                | Tests need determinism, not semantics                               | Real embeddings everywhere outside CI                                                    |
| No keyword/hybrid retrieval                            | Vector-only is sufficient at this corpus size                       | Hybrid (BM25 + vector, RRF fusion) + reranker — biggest quality lever                    |
| Fixed chunking (500 tok / 50 overlap, paragraph-aware) | Reasonable default                                                  | Semantic/structure-aware chunking per document class                                     |
| No CI pipeline in repo                                 | Assessed as a local artifact                                        | GitHub Actions: typecheck + tests + mock evals on PR; real evals nightly                 |
| Terraform not applied                                  | No cloud spend for an assessment                                    | `terraform plan` review + apply via CI with remote state & locking (backend block ready) |

---

## Roadmap (bonus items designed, not implemented)

- **Tool/function calling:** the pipeline's `invoke` stage already isolates the model call — add a tool-execution loop (propose → validate against allowlist → execute → feed back) with human-in-the-loop approval for irreversible actions (fintech requirement).
- **Async ingestion:** upload → S3 → SQS → workers (parse/chunk/embed) → status events; isolates slow PDFs from request latency and enables retry/DLQ.
- **Multi-tenant isolation:** `owner_id` scoping is already enforced in retrieval SQL; full isolation adds tenant-id on every table + RLS policies, per-tenant prompt config and per-tenant token budgets.
- **Observability:** OpenTelemetry traces per request (retrieval scores, prompt version, tokens) → the audit trail already persisted is the foundation; add dashboards for cost/latency/drift (answer-confidence distribution shift = model/prompt regression signal).
- **Voice channel:** their IVR/WhatsApp layer would plug in as another "Agent Experience" over the same pipeline — the provider abstraction extends to STT/TTS (OpenAI Realtime) without touching domain logic.

## Repository map

```
├── SPEC.md / PLAN.md / AGENTS.md   # spec-driven artifacts (requirements, phases, constitution)
├── backend/
│   ├── src/domain/       # types + ports (no external deps)
│   ├── src/ai/           # providers · prompts (versioned) · pipeline (3 stages)
│   ├── src/rag/          # parse · chunk · embed · retrieve
│   ├── src/api/          # routes (auth, documents, chat JSON + SSE)
│   ├── src/middleware/   # jwt · rate-limit · error-handler
│   ├── src/infra/        # pg pool + repositories
│   ├── evals/            # golden.json · run.ts · baseline/results
│   └── tests/            # 39 vitest tests
├── frontend/src/         # pages (login, upload, chat) · api client (SSE) · auth context
├── infra/db/init.sql     # schema: users, documents, chunks(vector 1536, HNSW), conversations, messages
├── infra/terraform/      # VPC · ECS Fargate · ALB · RDS · Secrets Manager · IAM · autoscaling
└── docker-compose.yml    # db + backend + frontend, healthchecked
```
