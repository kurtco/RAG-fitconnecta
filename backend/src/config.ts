import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
    JWT_SECRET: z.string().min(8),
    JWT_EXPIRES_IN: z.string().default("8h"),
    DATABASE_URL: z.string().min(1),
    LLM_PROVIDER: z.enum(["openai", "mock"]).default("mock"),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
    OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
    PROMPT_VERSION: z.string().default("v1"),
    RAG_TOP_K: z.coerce.number().int().positive().default(5),
    RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
    RAG_CHUNK_TOKENS: z.coerce.number().int().positive().default(500),
    RAG_CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(50),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),
  })
  .refine((env) => env.LLM_PROVIDER !== "openai" || Boolean(env.OPENAI_API_KEY), {
    message: "OPENAI_API_KEY is required when LLM_PROVIDER=openai",
    path: ["OPENAI_API_KEY"],
  });

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Single source of configuration (12-factor). Parsed and validated once at
 * bootstrap; fails fast on invalid environment. Never import process.env
 * anywhere else.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
