import express, { type Express } from "express";
import cors from "cors";
import type { AppConfig } from "./config.js";
import { createLLMProvider } from "./ai/providers/factory.js";
import { getPromptTemplate } from "./ai/prompts/registry.js";
import type { ChatPipelineDeps } from "./ai/pipeline/chat.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createApiRateLimiter, createLlmRateLimiter } from "./middleware/rate-limit.js";
import { createPool } from "./infra/db.js";
import { PgUserRepository } from "./infra/pg-user-repo.js";
import { PgConversationRepository, PgMessageRepository } from "./infra/pg-repos.js";
import { PgDocumentRepository } from "./infra/pg-document-repo.js";
import { PgChunkRepository } from "./infra/pg-chunk-repo.js";
import { createEmbeddingProvider } from "./rag/embed.js";
import { retrieveChunks } from "./rag/retrieve.js";
import { createAuthRouter } from "./api/routes/auth.js";
import { createChatRouter } from "./api/routes/chat.js";
import { createDocumentsRouter } from "./api/routes/documents.js";

export interface AppDeps {
  pool?: ReturnType<typeof createPool>;
  pipeline?: ChatPipelineDeps;
}

/** App factory: dependencies injected, testable without network (AGENTS.md #3). */
export function createApp(config: AppConfig, deps: AppDeps = {}): Express {
  const app = express();
  // Behind nginx (compose) / ALB (production): trust the first proxy hop so
  // req.ip is the real client and rate limiting keys per user, per proxy.
  app.set("trust proxy", 1);
  app.use(cors({ origin: config.FRONTEND_URL }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "finconecta-assessment-backend", provider: config.LLM_PROVIDER });
  });

  const pool = deps.pool ?? createPool(config.DATABASE_URL);
  const users = new PgUserRepository(pool);
  const conversations = new PgConversationRepository(pool);
  const messages = new PgMessageRepository(pool);
  const documents = new PgDocumentRepository(pool);
  const chunks = new PgChunkRepository(pool);

  const embeddings = createEmbeddingProvider({
    provider: config.LLM_PROVIDER,
    openaiApiKey: config.OPENAI_API_KEY,
    openaiEmbeddingModel: config.OPENAI_EMBEDDING_MODEL,
  });

  const pipeline: ChatPipelineDeps =
    deps.pipeline ?? {
      provider: createLLMProvider({
        provider: config.LLM_PROVIDER,
        openaiApiKey: config.OPENAI_API_KEY,
        openaiChatModel: config.OPENAI_CHAT_MODEL,
      }),
      template: getPromptTemplate(config.PROMPT_VERSION),
      retrieveContext: (question, ownerId) =>
        ownerId
          ? retrieveChunks({ embeddings, chunks }, ownerId, question, {
              topK: config.RAG_TOP_K,
              minScore: config.RAG_MIN_SCORE,
            })
          : Promise.resolve([]),
    };

  const requireAuth = createAuthMiddleware(config.JWT_SECRET);
  const apiLimiter = createApiRateLimiter(config);
  const llmLimiter = createLlmRateLimiter(config);

  app.use("/api/v1", apiLimiter);
  app.use("/api/v1/auth", createAuthRouter(users, config));
  app.use(
    "/api/v1/documents",
    requireAuth,
    createDocumentsRouter({ documents, chunks, embeddings, config }),
  );
  app.use("/api/v1/chat", requireAuth, llmLimiter, createChatRouter({ conversations, messages, pipeline }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
