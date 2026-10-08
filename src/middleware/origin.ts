import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

/**
 * Origin Check Middleware
 *
 * Rules:
 * 1. If an Origin header is present and NOT in ALLOWED_ORIGINS -> 403 Forbidden.
 * 2. If an Origin header is present and IN ALLOWED_ORIGINS -> set strict CORS headers.
 * 3. If NO Origin header is present (non-browser CLI clients, MCP Inspector, curl) -> allowed.
 * 4. Wildcard '*' CORS is strictly prohibited.
 */
export function originCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  // Non-browser clients (no Origin header) are allowed
  if (!origin) {
    return next();
  }

  // Browser client: check against ALLOWED_ORIGINS list
  if (!config.ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({
      error: "Forbidden",
      message: "Origin not allowed",
    });
    return;
  }

  // Origin is explicitly allowed: set exact origin (no wildcard)
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, mcp-session-id"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
