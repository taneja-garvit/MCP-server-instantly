import dotenv from "dotenv";
dotenv.config();

const port = process.env.PORT || "3000";
const baseUrl = `http://localhost:${port}`;
const token = process.env.VIEWER_TOKEN || process.env.ADMIN_TOKEN;

async function runLiveTest() {
  console.log("=================================================");
  console.log("   LOCAL STREAMABLE HTTP LIVE VERIFICATION TEST  ");
  console.log("=================================================");
  console.log(`Server URL: ${baseUrl}`);
  console.log(`Mock Mode:  ${process.env.MOCK_MODE}`);
  console.log(`API Key:    ${process.env.INSTANTLY_API_KEY ? "Present (" + process.env.INSTANTLY_API_KEY.length + " chars)" : "Missing"}\n`);

  if (!token) {
    console.error("Error: VIEWER_TOKEN or ADMIN_TOKEN is missing in .env");
    process.exit(1);
  }

  // 1. Test Health
  console.log("[1] Checking GET /health...");
  const healthRes = await fetch(`${baseUrl}/health`);
  if (!healthRes.ok) {
    console.error(`  Health check failed: HTTP ${healthRes.status}`);
    process.exit(1);
  }
  const healthJson = await healthRes.json();
  console.log("  Health response:", healthJson);

  // 2. Test Streamable HTTP Initialize
  console.log("\n[2] Testing Streamable HTTP POST /mcp (initialize)...");
  const initRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "local-live-tester", version: "1.0.0" },
      },
    }),
  });

  if (!initRes.ok) {
    console.error(`  Initialize failed: HTTP ${initRes.status}`, await initRes.text());
    process.exit(1);
  }
  console.log("  Initialize successful! Status:", initRes.status);

  // 3. Test Tools List
  console.log("\n[3] Testing tools/list over Streamable HTTP...");
  const listRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  const listText = await listRes.text();
  const listData = parseMcpResponse(listText);
  const tools = listData.result?.tools?.map((t: any) => t.name) || [];
  console.log(`  Discovered ${tools.length} tools for this role:`, tools);

  // 4. Test get_workspace_summary
  console.log("\n[4] Calling get_workspace_summary over Streamable HTTP...");
  const summaryRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_workspace_summary",
        arguments: {},
      },
    }),
  });

  const summaryText = await summaryRes.text();
  const summaryData = parseMcpResponse(summaryText);
  if (summaryData.result?.isError) {
    console.error("  Tool returned error:", summaryData.result?.content?.[0]?.text);
  } else {
    console.log("  Workspace summary response:\n", summaryData.result?.content?.[0]?.text);
  }

  // 5. Test list_campaigns
  console.log("\n[5] Calling list_campaigns (limit=3)...");
  const campRes = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "list_campaigns",
        arguments: { limit: 3 },
      },
    }),
  });

  const campText = await campRes.text();
  const campData = parseMcpResponse(campText);
  if (campData.result?.isError) {
    console.error("  Tool returned error:", campData.result?.content?.[0]?.text);
  } else {
    console.log("  Campaigns response:\n", campData.result?.content?.[0]?.text);
  }

  console.log("\n=================================================");
  console.log("   LOCAL STREAMABLE HTTP TEST COMPLETED!         ");
  console.log("=================================================");
}

function parseMcpResponse(rawText: string): any {
  if (!rawText) return {};
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

runLiveTest().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
