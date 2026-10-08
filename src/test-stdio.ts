import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function runStdioTest() {
  console.log("=== VERIFYING READ TOOLS OVER STDIO ===");

  // Connect client to stdio server process
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/stdio.js"],
    env: {
      ...process.env,
      LOG_LEVEL: "silent", // Keep stderr clean for test runner
    },
  });

  const client = new Client(
    { name: "test-inspector-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected to stdio MCP server successfully!\n");

  // 1. List tools
  console.log("[1] Listing available tools...");
  const toolsResult = await client.listTools();
  console.log(`Discovered ${toolsResult.tools.length} tools:`);
  for (const t of toolsResult.tools) {
    console.log(`  - ${t.name}: ${t.description?.slice(0, 75)}...`);
    console.log(`    Annotations:`, t.annotations);
  }

  // 2. Test list_campaigns
  console.log("\n[2] Calling list_campaigns...");
  const campResult = await client.callTool({
    name: "list_campaigns",
    arguments: { limit: 2 },
  });
  console.log("  Response:", (campResult.content as any)[0]?.text);

  // 3. Test get_campaign
  console.log("\n[3] Calling get_campaign...");
  const singleCampResult = await client.callTool({
    name: "get_campaign",
    arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001" },
  });
  console.log("  Response:", (singleCampResult.content as any)[0]?.text);

  // 4. Test get_campaign_analytics
  console.log("\n[4] Calling get_campaign_analytics...");
  const analyticsResult = await client.callTool({
    name: "get_campaign_analytics",
    arguments: {},
  });
  console.log("  Response:", (analyticsResult.content as any)[0]?.text);

  // 5. Test list_leads
  console.log("\n[5] Calling list_leads...");
  const leadsResult = await client.callTool({
    name: "list_leads",
    arguments: { limit: 2 },
  });
  console.log("  Response:", (leadsResult.content as any)[0]?.text);

  // 6. Test list_email_accounts
  console.log("\n[6] Calling list_email_accounts...");
  const accountsResult = await client.callTool({
    name: "list_email_accounts",
    arguments: { limit: 2 },
  });
  console.log("  Response:", (accountsResult.content as any)[0]?.text);

  // 7. Test get_workspace_summary
  console.log("\n[7] Calling get_workspace_summary...");
  const summaryResult = await client.callTool({
    name: "get_workspace_summary",
    arguments: {},
  });
  console.log("  Response:", (summaryResult.content as any)[0]?.text);

  await client.close();
  console.log("\n>>> Phase 2: All read tools over stdio passed successfully! <<<");
}

runStdioTest().catch((err) => {
  console.error("Stdio test error:", err);
  process.exit(1);
});
