import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { parseMcpResponse } from "./test-utils.js";

describe("Role-Based Access Control (RBAC)", () => {
  const app = createApp();

  it("viewer cannot see add_lead, pause_campaign, or activate_campaign in tools/list", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });

    expect(res.status).toBe(200);
    const data = parseMcpResponse(res.text);
    const toolNames = data.result?.tools?.map((t: any) => t.name) || [];

    expect(toolNames).toContain("list_campaigns");
    expect(toolNames).toContain("get_campaign");
    expect(toolNames).toContain("get_campaign_analytics");
    expect(toolNames).toContain("list_leads");
    expect(toolNames).toContain("list_email_accounts");
    expect(toolNames).toContain("get_workspace_summary");

    // Operator and admin tools must NOT be visible
    expect(toolNames).not.toContain("add_lead");
    expect(toolNames).not.toContain("pause_campaign");
    expect(toolNames).not.toContain("activate_campaign");
    expect(toolNames.length).toBe(6);
  });

  it("viewer cannot call pause_campaign", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "pause_campaign",
          arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001" },
        },
      });

    const data = parseMcpResponse(res.text);
    // Should be rejected by MCP server (tool not found / isError)
    expect(data.error || data.result?.isError).toBeTruthy();
  });

  it("operator can see and call add_lead and pause_campaign, but cannot see activate_campaign", async () => {
    const listRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      });

    expect(listRes.status).toBe(200);
    const listData = parseMcpResponse(listRes.text);
    const toolNames = listData.result?.tools?.map((t: any) => t.name) || [];

    expect(toolNames).toContain("add_lead");
    expect(toolNames).toContain("pause_campaign");
    expect(toolNames).not.toContain("activate_campaign");
    expect(toolNames.length).toBe(8);

    // Call pause_campaign as operator
    const pauseRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "pause_campaign",
          arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001" },
        },
      });

    const pauseData = parseMcpResponse(pauseRes.text);
    expect(pauseData.result?.isError).toBeFalsy();
    const resultObj = JSON.parse(pauseData.result?.content?.[0]?.text);
    expect(resultObj.success).toBe(true);
    expect(resultObj.status).toBe("Paused");
  });

  it("operator cannot call activate_campaign", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "activate_campaign",
          arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001", confirm: true },
        },
      });

    const data = parseMcpResponse(res.text);
    expect(data.error || data.result?.isError).toBeTruthy();
  });

  it("activate_campaign is rejected when ENABLE_ADMIN_TOOLS is false", async () => {
    (config as any).ENABLE_ADMIN_TOOLS = false;

    const listRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/list",
        params: {},
      });

    const listData = parseMcpResponse(listRes.text);
    const toolNames = listData.result?.tools?.map((t: any) => t.name) || [];
    expect(toolNames).not.toContain("activate_campaign");

    const callRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "activate_campaign",
          arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001", confirm: true },
        },
      });

    const callData = parseMcpResponse(callRes.text);
    expect(callData.error || callData.result?.isError).toBeTruthy();
  });

  it("activate_campaign requires explicit confirm: true even when ENABLE_ADMIN_TOOLS is true", async () => {
    (config as any).ENABLE_ADMIN_TOOLS = true;

    // Call without confirm: true (confirm: false)
    const rejectRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "activate_campaign",
          arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001", confirm: false },
        },
      });

    const rejectData = parseMcpResponse(rejectRes.text);
    expect(rejectData.result?.isError).toBe(true);
    expect(rejectData.result?.content?.[0]?.text).toContain("Refusing to activate campaign: confirm must be explicitly true");

    // Call with confirm: true
    const successRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "activate_campaign",
          arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001", confirm: true },
        },
      });

    const successData = parseMcpResponse(successRes.text);
    expect(successData.result?.isError).toBeFalsy();
    const resultObj = JSON.parse(successData.result?.content?.[0]?.text);
    expect(resultObj.success).toBe(true);
    expect(resultObj.status).toBe("Active");

    // Reset flag
    (config as any).ENABLE_ADMIN_TOOLS = false;
  });
});
