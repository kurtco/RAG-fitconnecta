import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createAuthMiddleware(jwtSecret: string) {
  return function authMiddleware(
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): void {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      next(new ApiError(401, "missing_token", "Authorization Bearer token required"));
      return;
    }
    try {
      const payload = jwt.verify(header.slice("Bearer ".length), jwtSecret) as {
        sub?: string;
        email?: string;
      };
      if (!payload.sub) {
        throw new Error("Token missing subject");
      }
      req.user = { id: payload.sub, email: payload.email ?? "" };
      next();
    } catch {
      next(new ApiError(401, "invalid_token", "Invalid or expired token"));
    }
  };
}
