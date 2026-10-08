import request from "supertest";
import { createApp } from "./app.js";
import { config } from "./config.js";

async function verifyPhase3() {
  console.log("=== PHASE 3 VERIFICATION: EXPRESS + STREAMABLE HTTP + MIDDLEWARE ===");
  const app = createApp();

  // Test 1: GET /health (unauthenticated)
  console.log("\n[Test 1] GET /health (unauthenticated)...");
  const resHealth = await request(app).get("/health");
  console.log("  Status:", resHealth.status);
  console.log("  Body:", resHealth.body);
  if (resHealth.status !== 200 || resHealth.body.status !== "ok") {
    throw new Error("GET /health failed");
  }

  // Test 2: Method Not Allowed on /mcp
  console.log("\n[Test 2] GET and DELETE on /mcp return 405...");
  const resGetMcp = await request(app).get("/mcp");
  console.log("  GET /mcp status:", resGetMcp.status, "Allow header:", resGetMcp.headers["allow"]);
  if (resGetMcp.status !== 405) throw new Error("GET /mcp should return 405");

  const resDelMcp = await request(app).delete("/mcp");
  console.log("  DELETE /mcp status:", resDelMcp.status);
  if (resDelMcp.status !== 405) throw new Error("DELETE /mcp should return 405");

  // Test 3: Missing Auth on POST /mcp -> 401 with WWW-Authenticate
  console.log("\n[Test 3] Missing Authorization on POST /mcp returns 401...");
  const resNoAuth = await request(app)
    .post("/mcp")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  console.log("  Status:", resNoAuth.status);
  console.log("  WWW-Authenticate:", resNoAuth.headers["www-authenticate"]);
  console.log("  Body:", resNoAuth.body);
  if (resNoAuth.status !== 401 || !resNoAuth.headers["www-authenticate"]) {
    throw new Error("Missing auth should return 401 with WWW-Authenticate header");
  }

  // Test 4: Invalid Auth token on POST /mcp -> 401
  console.log("\n[Test 4] Invalid token on POST /mcp returns 401...");
  const resBadToken = await request(app)
    .post("/mcp")
    .set("Authorization", "Bearer invalid_secret_token_12345678901234567890")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  console.log("  Status:", resBadToken.status);
  console.log("  Body:", resBadToken.body);
  if (resBadToken.status !== 401) throw new Error("Invalid token should return 401");

  // Test 5: Disallowed Origin -> 403 Forbidden
  console.log("\n[Test 5] Disallowed Origin returns 403...");
  const resBadOrigin = await request(app)
    .post("/mcp")
    .set("Origin", "https://malicious-attacker-website.com")
    .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  console.log("  Status:", resBadOrigin.status);
  console.log("  Body:", resBadOrigin.body);
  if (resBadOrigin.status !== 403) throw new Error("Disallowed origin should return 403");

  // Test 6: Allowed Origin -> sets CORS headers
  console.log("\n[Test 6] Allowed Origin returns CORS headers...");
  const resGoodOrigin = await request(app)
    .options("/mcp")
    .set("Origin", "http://localhost:3000");
  console.log("  OPTIONS status:", resGoodOrigin.status);
  console.log("  Access-Control-Allow-Origin:", resGoodOrigin.headers["access-control-allow-origin"]);
  if (resGoodOrigin.headers["access-control-allow-origin"] !== "http://localhost:3000") {
    throw new Error("Allowed origin should reflect exact origin");
  }

  // Test 7: Oversized JSON payload (> 100kb) -> 413
  console.log("\n[Test 7] Oversized JSON body (> 100kb) returns 413...");
  const largeData = "x".repeat(110 * 1024); // 110kb string
  const resOversized = await request(app)
    .post("/mcp")
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
    .send(JSON.stringify({ largeField: largeData }));
  console.log("  Status:", resOversized.status);
  console.log("  Body:", resOversized.body);
  if (resOversized.status !== 413) throw new Error("Oversized payload should return 413");

  // Test 8: Valid viewer token -> Streamable HTTP initialize + tools/list
  console.log("\n[Test 8] Valid viewer token on POST /mcp (Streamable HTTP initialize)...");
  const resInit = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
  console.log("  Status:", resInit.status);
  console.log("  Response:", resInit.text.slice(0, 200), "...");
  if (resInit.status !== 200) throw new Error("Initialize failed with viewer token");

  console.log("\n[Test 9] Valid viewer token tools/list (Streamable HTTP)...");
  const resTools = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
  console.log("  Status:", resTools.status);
  console.log("  Response:", resTools.text.slice(0, 300), "...");
  if (resTools.status !== 200) throw new Error("tools/list failed with viewer token");

  console.log("\n>>> Phase 3: Express, Streamable HTTP, and all 5 middleware steps verified successfully! <<<");
}

verifyPhase3().catch((err) => {
  console.error("Phase 3 verification failed:", err);
  process.exit(1);
});
