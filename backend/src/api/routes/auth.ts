import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { UserRepository } from "../../domain/ports.js";
import { ApiError } from "../../middleware/auth.js";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

export function createAuthRouter(
  users: UserRepository,
  config: Pick<AppConfig, "JWT_SECRET" | "JWT_EXPIRES_IN">,
): Router {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      const { email, password } = credentialsSchema.parse(req.body);
      const existing = await users.findByEmail(email);
      if (existing) {
        throw new ApiError(409, "email_taken", "An account with this email already exists");
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await users.create(email, passwordHash);
      res.status(201).json({
        token: signToken(user.id, user.email, config),
        user: { id: user.id, email: user.email },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const { email, password } = credentialsSchema.parse(req.body);
      const user = await users.findByEmail(email);
      // Same error for unknown email and bad password (no account enumeration)
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new ApiError(401, "invalid_credentials", "Invalid email or password");
      }
      res.json({
        token: signToken(user.id, user.email, config),
        user: { id: user.id, email: user.email },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function signToken(
  userId: string,
  email: string,
  config: Pick<AppConfig, "JWT_SECRET" | "JWT_EXPIRES_IN">,
): string {
  return jwt.sign({ sub: userId, email }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}
