import rateLimit from "express-rate-limit";
import type { AppConfig } from "../config.js";

/**
 * Per-user (IP-keyed) rate limiting — part of the cost-control story
 * required by SPEC B9. Production hardening (per-account quotas, token
 * budgets, queueing) is discussed in README §Costs.
 */
export function createApiRateLimiter(config: AppConfig) {
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: { code: "rate_limited", message: "Too many requests, slow down" },
    },
  });
}

/** Stricter limiter for expensive LLM endpoints. */
export function createLlmRateLimiter(config: AppConfig) {
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: Math.max(5, Math.floor(config.RATE_LIMIT_MAX / 3)),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: { code: "rate_limited", message: "LLM rate limit reached, try again shortly" },
    },
  });
}
