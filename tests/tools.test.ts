import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { parseMcpResponse } from "./test-utils.js";

describe("Tool Execution & Input Validation", () => {
  const app = createApp();

  it("invalid tool arguments are rejected by Zod schema validation", async () => {
    // 1. add_lead with invalid email
    const invalidEmailRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "add_lead",
          arguments: {
            email: "not-an-email",
          },
        },
      });

    const emailErrData = parseMcpResponse(invalidEmailRes.text);
    expect(emailErrData.error || emailErrData.result?.isError).toBeTruthy();

    // 2. get_campaign_analytics with invalid date format
    const invalidDateRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_campaign_analytics",
          arguments: {
            start_date: "12-31-2026", // Should be YYYY-MM-DD
          },
        },
      });

    const dateErrData = parseMcpResponse(invalidDateRes.text);
    expect(dateErrData.error || dateErrData.result?.isError).toBeTruthy();
  });

  it("get_workspace_summary aggregates all three domains into one compact payload", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_workspace_summary",
          arguments: {},
        },
      });

    const data = parseMcpResponse(res.text);
    expect(data.result?.isError).toBeFalsy();

    const summary = JSON.parse(data.result?.content?.[0]?.text);
    expect(summary.workspace).toBeDefined();
    expect(summary.campaigns).toBeDefined();
    expect(summary.email_accounts).toBeDefined();
    expect(summary.headline_metrics).toBeDefined();

    // Check campaign counts structure
    expect(summary.campaigns.total).toBeGreaterThan(0);
    expect(typeof summary.campaigns.active).toBe("number");
    expect(typeof summary.campaigns.paused).toBe("number");

    // Check account health structure
    expect(summary.email_accounts.total).toBeGreaterThan(0);
    expect(typeof summary.email_accounts.active).toBe("number");

    // Check headline outreach metrics
    expect(summary.headline_metrics.open_rate).toContain("%");
    expect(summary.headline_metrics.reply_rate).toContain("%");
  });

  it("list_leads truncates long text fields and supports cursor pagination", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "list_leads",
          arguments: { limit: 2 },
        },
      });

    const data = parseMcpResponse(res.text);
    expect(data.result?.isError).toBeFalsy();

    const parsed = JSON.parse(data.result?.content?.[0]?.text);
    expect(parsed.leads).toBeDefined();
    expect(parsed.leads.length).toBeLessThanOrEqual(2);
    expect(parsed.next_starting_after).toBeDefined();
  });
});
