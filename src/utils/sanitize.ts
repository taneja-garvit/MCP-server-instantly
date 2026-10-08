/**
 * Truncate untrusted external strings (campaign names, lead notes, email subjects/bodies)
 * to ~200 characters to mitigate prompt injection risk and avoid context window pollution.
 */
export function sanitizeString(val: unknown, maxLength = 200): string {
  if (val === null || val === undefined) return "";
  const str = String(val).trim();
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + " [truncated]";
}

/**
 * Maps campaign status code to clear human-readable string.
 */
export function formatCampaignStatus(status: number): string {
  const map: Record<number, string> = {
    0: "Draft",
    1: "Active",
    2: "Paused",
    3: "Completed",
    4: "Running Subsequences",
    "-99": "Account Suspended",
    "-1": "Accounts Unhealthy",
    "-2": "Bounce Protect",
  };
  return map[status] || `Unknown (${status})`;
}

/**
 * Maps account status code to human-readable string.
 */
export function formatAccountStatus(status: number): string {
  const map: Record<number, string> = {
    1: "Active",
    2: "Paused",
    3: "Maintenance Paused",
    "-1": "Connection Error",
    "-2": "Soft Bounce Error",
    "-3": "Sending Error",
  };
  return map[status] || `Unknown (${status})`;
}
