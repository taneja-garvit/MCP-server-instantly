export class InstantlyApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "InstantlyApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class InstantlyTimeoutError extends InstantlyApiError {
  constructor(timeoutMs: number) {
    super(`Request to Instantly API timed out after ${timeoutMs / 1000}s`, 408, "TIMEOUT");
    this.name = "InstantlyTimeoutError";
  }
}

export class InstantlyRateLimitError extends InstantlyApiError {
  public readonly retryAfterSeconds?: number;

  constructor(retryAfterSeconds?: number) {
    const msg = retryAfterSeconds
      ? `Rate limited by Instantly, retry in ~${retryAfterSeconds}s`
      : "Rate limited by Instantly, retry in ~30s";
    super(msg, 429, "RATE_LIMIT_EXCEEDED");
    this.name = "InstantlyRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class InstantlyAuthError extends InstantlyApiError {
  constructor(message: string = "Instantly API key is invalid or revoked") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "InstantlyAuthError";
  }
}

/**
 * Maps any caught error from Instantly calls into a clean, safe,
 * actionable message suitable for LLM tool results without leaking
 * stack traces, internal paths, or sensitive payload details.
 */
export function formatActionableErrorMessage(err: unknown): string {
  if (err instanceof InstantlyRateLimitError) {
    return err.retryAfterSeconds
      ? `Rate limited by Instantly, retry in ~${err.retryAfterSeconds}s.`
      : "Rate limited by Instantly, retry in ~30s.";
  }
  if (err instanceof InstantlyTimeoutError) {
    return "Instantly API request timed out after 10s. Please retry shortly.";
  }
  if (err instanceof InstantlyAuthError) {
    return "Authentication failed with upstream Instantly API. Please check your INSTANTLY_API_KEY.";
  }
  if (err instanceof InstantlyApiError) {
    if (err.statusCode === 404) {
      return "The requested resource was not found in Instantly.";
    }
    if (err.statusCode === 400) {
      return `Invalid request to Instantly: ${err.message}`;
    }
    if (err.statusCode >= 500) {
      return "Instantly service is temporarily unavailable. Please retry in a few moments.";
    }
    return `Instantly API error (${err.statusCode}): ${err.message}`;
  }
  if (err instanceof Error) {
    return `Operation failed: ${err.message}`;
  }
  return "An unexpected error occurred while communicating with Instantly.";
}
