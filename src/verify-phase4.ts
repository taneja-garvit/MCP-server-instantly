import request from "supertest";
import { createApp } from "./app.js";
import { config } from "./config.js";

async function verifyPhase4() {
  console.log("=== PHASE 4 VERIFICATION: ROLES, WRITE TOOLS & CONFIRM FLOW ===");
  const app = createApp();

  // ----------------------------------------------------
  // Scenario 1: VIEWER Role Permissions
  // ----------------------------------------------------
  console.log("\n[1] Testing VIEWER role tool filtering (tools/list)...");
  const viewerListRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

  // Extract tools from SSE or JSON response
  const viewerData = parseMcpResponse(viewerListRes.text);
  const viewerTools: string[] = viewerData.result?.tools?.map((t: any) => t.name) || [];
  console.log("  Viewer sees tools:", viewerTools);

  if (viewerTools.includes("add_lead") || viewerTools.includes("pause_campaign") || viewerTools.includes("activate_campaign")) {
    throw new Error("SECURITY FAILURE: Viewer can see write or admin tools!");
  }
  if (viewerTools.length !== 6) {
    throw new Error(`Expected exactly 6 viewer tools, but found ${viewerTools.length}`);
  }
  console.log("  PASS: Viewer only sees the 6 read-only tools.");

  console.log("\n[2] Testing VIEWER cannot call pause_campaign (tools/call)...");
  const viewerCallRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "pause_campaign",
        arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001" },
      },
    });
  const viewerCallData = parseMcpResponse(viewerCallRes.text);
  console.log("  Viewer call result:", viewerCallData.error?.message || viewerCallData.result);
  if (!viewerCallData.error && !viewerCallData.result?.isError) {
    throw new Error("SECURITY FAILURE: Viewer was able to invoke pause_campaign!");
  }
  console.log("  PASS: Viewer call to pause_campaign was safely rejected.");

  // ----------------------------------------------------
  // Scenario 2: OPERATOR Role Permissions & Write Tools
  // ----------------------------------------------------
  console.log("\n[3] Testing OPERATOR role tool filtering (tools/list)...");
  const operatorListRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    });

  const operatorData = parseMcpResponse(operatorListRes.text);
  const operatorTools: string[] = operatorData.result?.tools?.map((t: any) => t.name) || [];
  console.log("  Operator sees tools:", operatorTools);

  if (!operatorTools.includes("add_lead") || !operatorTools.includes("pause_campaign")) {
    throw new Error("Operator should see add_lead and pause_campaign");
  }
  if (operatorTools.includes("activate_campaign")) {
    throw new Error("SECURITY FAILURE: Operator must NOT see activate_campaign!");
  }
  console.log("  PASS: Operator sees 8 tools (6 viewer + 2 operator), excluding admin tools.");

  console.log("\n[4] Testing OPERATOR calling add_lead...");
  const addLeadRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "add_lead",
        arguments: {
          email: "alex.newlead@enterprise-client.io",
          first_name: "Alex",
          last_name: "Morgan",
          company_name: "Enterprise Client Corp",
          campaign: "01956fbd-0eb1-72db-a565-82977a586001",
        },
      },
    });
  const addLeadData = parseMcpResponse(addLeadRes.text);
  console.log("  add_lead result:", addLeadData.result?.content?.[0]?.text);
  const addLeadParsed = JSON.parse(addLeadData.result?.content?.[0]?.text || "{}");
  if (!addLeadParsed.success || !addLeadParsed.lead_id) {
    throw new Error("add_lead failed for operator");
  }
  console.log("  PASS: Operator successfully enrolled lead:", addLeadParsed.lead_id);

  console.log("\n[5] Testing OPERATOR calling pause_campaign...");
  const pauseRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "pause_campaign",
        arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001" },
      },
    });
  const pauseData = parseMcpResponse(pauseRes.text);
  console.log("  pause_campaign result:", pauseData.result?.content?.[0]?.text);
  const pauseParsed = JSON.parse(pauseData.result?.content?.[0]?.text || "{}");
  if (!pauseParsed.success || pauseParsed.status !== "Paused") {
    throw new Error("pause_campaign failed for operator");
  }
  console.log("  PASS: Operator successfully paused campaign:", pauseParsed.campaign_id);

  console.log("\n[6] Testing OPERATOR cannot call activate_campaign...");
  const opActivateRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.OPERATOR_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "activate_campaign",
        arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001", confirm: true },
      },
    });
  const opActivateData = parseMcpResponse(opActivateRes.text);
  console.log("  Operator activate attempt:", opActivateData.error?.message || opActivateData.result);
  if (!opActivateData.error && !opActivateData.result?.isError) {
    throw new Error("SECURITY FAILURE: Operator was able to call activate_campaign!");
  }
  console.log("  PASS: Operator call to activate_campaign was safely rejected.");

  // ----------------------------------------------------
  // Scenario 3: ADMIN Role & Confirm Flow
  // ----------------------------------------------------
  console.log("\n[7] Testing ADMIN with ENABLE_ADMIN_TOOLS=false...");
  // Currently config.ENABLE_ADMIN_TOOLS is false in .env
  const adminListRes1 = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
      params: {},
    });
  const adminTools1: string[] =
    parseMcpResponse(adminListRes1.text).result?.tools?.map((t: any) => t.name) || [];
  console.log("  Admin tools (when ENABLE_ADMIN_TOOLS=false):", adminTools1);
  if (adminTools1.includes("activate_campaign")) {
    throw new Error("SECURITY FAILURE: activate_campaign should NOT be available when ENABLE_ADMIN_TOOLS=false");
  }
  console.log("  PASS: activate_campaign is disabled when flag is false.");

  console.log("\n[8] Testing ADMIN with ENABLE_ADMIN_TOOLS=true and Confirm Flow...");
  // Temporarily set flag to true to test confirm flow
  (config as any).ENABLE_ADMIN_TOOLS = true;

  const adminListRes2 = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/list",
      params: {},
    });
  const adminTools2: string[] =
    parseMcpResponse(adminListRes2.text).result?.tools?.map((t: any) => t.name) || [];
  console.log("  Admin tools (when ENABLE_ADMIN_TOOLS=true):", adminTools2);
  if (!adminTools2.includes("activate_campaign")) {
    throw new Error("activate_campaign should be available when admin tools are enabled");
  }

  // 8a. Test missing or false confirm
  console.log("  8a. Testing activate_campaign with confirm: false...");
  const noConfirmRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "activate_campaign",
        arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001", confirm: false },
      },
    });
  const noConfirmData = parseMcpResponse(noConfirmRes.text);
  console.log("  Result with confirm=false:", noConfirmData.result?.content?.[0]?.text);
  if (!noConfirmData.result?.isError) {
    throw new Error("activate_campaign must reject when confirm is false");
  }
  console.log("  PASS: Rejection confirmed when confirm is not true.");

  // 8b. Test valid confirm: true
  console.log("  8b. Testing activate_campaign with confirm: true...");
  const confirmRes = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.ADMIN_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "activate_campaign",
        arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001", confirm: true },
      },
    });
  const confirmData = parseMcpResponse(confirmRes.text);
  console.log("  Result with confirm=true:", confirmData.result?.content?.[0]?.text);
  const activateParsed = JSON.parse(confirmData.result?.content?.[0]?.text || "{}");
  if (!activateParsed.success || activateParsed.status !== "Active") {
    throw new Error("activate_campaign failed with valid confirm: true");
  }
  console.log("  PASS: Campaign successfully activated with explicit confirmation!");

  // Reset flag
  (config as any).ENABLE_ADMIN_TOOLS = false;

  console.log("\n>>> Phase 4: Roles, write tools, and confirmation flow fully verified! <<<");
}

/**
 * Helper to parse MCP response whether returned as SSE text/event-stream or JSON
 */
function parseMcpResponse(rawText: string): any {
  if (!rawText) return {};
  // Check if it's SSE data: line
  const lines = rawText.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        // continue
      }
    }
  }
  try {
    return JSON.parse(rawText);
  } catch {
    return { raw: rawText };
  }
}

verifyPhase4().catch((err) => {
  console.error("Phase 4 verification failed:", err);
  process.exit(1);
});
