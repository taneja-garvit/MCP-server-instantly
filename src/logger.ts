import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "authorization",
      "Authorization",
      "api_key",
      "apiKey",
      "INSTANTLY_API_KEY",
      "*.authorization",
      "*.*.authorization",
      "token",
      "VIEWER_TOKEN",
      "OPERATOR_TOKEN",
      "ADMIN_TOKEN",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Dedicated structured audit log for tool invocations.
 * Emits exactly one audit line per tool call:
 * timestamp, role, tool name, success/failure.
 *
 * CRITICAL SECURITY / PRIVACY REQUIREMENT:
 * Never log lead emails, contact details, or email message bodies.
 */
export function auditToolCall(params: {
  role: string;
  tool: string;
  success: boolean;
  durationMs?: number;
  error?: string;
}): void {
  logger.info({
    audit: true,
    timestamp: new Date().toISOString(),
    role: params.role,
    tool: params.tool,
    success: params.success,
    ...(params.durationMs !== undefined && { durationMs: params.durationMs }),
    ...(params.error && { error: params.error }),
  }, `[AUDIT] tool=${params.tool} role=${params.role} success=${params.success}`);
}
