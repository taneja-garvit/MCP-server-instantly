import crypto from "node:crypto";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";

/**
 * Rate Limit Middleware
 *
 * Rate limits requests per token hash (or fallback IP for unauthenticated requests).
 * Hashing the token ensures raw authorization credentials are never held in cache keys.
 */
export const rateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 120, // 120 requests per minute
  standardHeaders: true, // draft-6/draft-7 RateLimit headers
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      // Hash the token so rate-limiter memory stores an opaque SHA-256 digest
      return crypto.createHash("sha256").update(token).digest("hex");
    }
    return req.ip || req.socket.remoteAddress || "anonymous";
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: "Too Many Requests",
      message: "Rate limit exceeded, retry in ~30s",
    });
  },
});
