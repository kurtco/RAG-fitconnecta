import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "./auth.js";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: "not_found", message: `No route ${req.method} ${req.path}` } });
}

/**
 * Centralized error handler. Never leaks stack traces or internal details
 * to clients (SPEC B/D2: safe logging + no info disclosure).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
    });
    return;
  }
  if (err instanceof Error && (err as Error & { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "invalid_json", message: "Malformed JSON body" } });
    return;
  }
  console.error("[error]", err instanceof Error ? err.message : err);
  res.status(500).json({ error: { code: "internal_error", message: "Unexpected server error" } });
}
