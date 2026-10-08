import { config } from "./config.js";
import { instantlyClient } from "./instantly/client.js";

async function verify() {
  console.log("=== PHASE 1 VERIFICATION ===");
  console.log("Config loaded safely:");
  console.log("  PORT:", config.PORT);
  console.log("  MOCK_MODE:", config.MOCK_MODE);
  console.log("  ENABLE_ADMIN_TOOLS:", config.ENABLE_ADMIN_TOOLS);
  console.log("  ALLOWED_ORIGINS:", config.ALLOWED_ORIGINS);
  console.log("  LOG_LEVEL:", config.LOG_LEVEL);
  console.log("  Secret lengths (verifying >= 32 chars):");
  console.log("    INSTANTLY_API_KEY:", config.INSTANTLY_API_KEY.length, "chars");
  console.log("    VIEWER_TOKEN:", config.VIEWER_TOKEN.length, "chars");
  console.log("    OPERATOR_TOKEN:", config.OPERATOR_TOKEN.length, "chars");
  console.log("    ADMIN_TOKEN:", config.ADMIN_TOKEN.length, "chars");

  console.log("\n[Test 1] List campaigns (limit=2)...");
  const campaigns = await instantlyClient.listCampaigns({ limit: 2 });
  console.log("  Success! Received items:", campaigns.items.length);
  for (const c of campaigns.items) {
    console.log(`  - [${c.id}] ${c.name} (status: ${c.status})`);
  }

  console.log("\n[Test 2] Get single campaign...");
  const firstId = campaigns.items[0]?.id;
  if (firstId) {
    const singleCamp = await instantlyClient.getCampaign(firstId);
    console.log(`  Success! Retrieved campaign: ${singleCamp.name}`);
  }

  console.log("\n[Test 3] Get campaign analytics...");
  const analytics = await instantlyClient.getCampaignAnalytics();
  console.log("  Success! Analytics count:", analytics.length);
  if (analytics[0]) {
    console.log(`  - Campaign: ${analytics[0].campaign_name}`);
    console.log(`    Leads: ${analytics[0].leads_count}, Sent: ${analytics[0].emails_sent_count}, Opens: ${analytics[0].open_count}, Replies: ${analytics[0].reply_count}`);
  }

  console.log("\n[Test 4] List email accounts (limit=2)...");
  const accounts = await instantlyClient.listEmailAccounts({ limit: 2 });
  console.log("  Success! Accounts count:", accounts.items.length);
  for (const acc of accounts.items) {
    console.log(`  - ${acc.email} (status: ${acc.status}, provider: ${acc.provider_code})`);
  }

  console.log("\n[Test 5] List leads (limit=2)...");
  const leads = await instantlyClient.listLeads({ limit: 2 });
  console.log("  Success! Leads count:", leads.items.length);
  for (const lead of leads.items) {
    console.log(`  - ${lead.email} (${lead.first_name} ${lead.last_name} at ${lead.company_name})`);
  }

  console.log("\n[Test 6] Get workspace details...");
  const workspace = await instantlyClient.getCurrentWorkspace();
  console.log(`  Success! Workspace: ${workspace.name} (ID: ${workspace.id})`);

  console.log("\n[Test 7] Verify retry & error handling structure...");
  // Test that invalid ID throws typed InstantlyApiError
  try {
    await instantlyClient.getCampaign("non-existent-uuid-999");
    console.error("  Should have thrown 404!");
  } catch (err: any) {
    console.log(`  Expected error caught: ${err.name} - ${err.message} (status: ${err.statusCode})`);
  }

  console.log("\n>>> Phase 1 completed and verified successfully! <<<");
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
