import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import type { UserRole } from "../types/roles.js";

declare global {
  namespace Express {
    interface Request {
      userRole?: UserRole;
    }
  }
}

/**
 * Constant-time token comparison via SHA-256 digests.
 * Hashing before timingSafeEqual guarantees both buffers are exactly 32 bytes,
 * preventing buffer length mismatch exceptions and eliminating timing side-channels.
 */
function constantTimeEquals(candidate: string, secret: string): boolean {
  const hashCandidate = crypto.createHash("sha256").update(candidate).digest();
  const hashSecret = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(hashCandidate, hashSecret);
}

/**
 * Bearer Authentication Middleware
 *
 * Validates the Authorization header using constant-time comparison against configured role tokens.
 * Emits WWW-Authenticate: Bearer header on 401 Unauthorized.
 * Attaches the resolved UserRole (viewer | operator | admin) to req.userRole.
 */
export function bearerAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="instantly-mcp"');
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
    });
    return;
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    res.status(401).json({
      error: "Unauthorized",
      message: "Bearer token cannot be empty.",
    });
    return;
  }

  // Constant-time checks against each role token
  let role: UserRole | undefined;

  if (constantTimeEquals(token, config.ADMIN_TOKEN)) {
    role = "admin";
  } else if (constantTimeEquals(token, config.OPERATOR_TOKEN)) {
    role = "operator";
  } else if (constantTimeEquals(token, config.VIEWER_TOKEN)) {
    role = "viewer";
  }

  if (!role) {
    res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid Bearer token.",
    });
    return;
  }

  req.userRole = role;
  next();
}
