import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { parseMcpResponse } from "./test-utils.js";

describe("Secret Protection & Leakage Prevention", () => {
  const app = createApp();

  const secrets = [
    config.INSTANTLY_API_KEY,
    config.VIEWER_TOKEN,
    config.OPERATOR_TOKEN,
    config.ADMIN_TOKEN,
  ];

  it("secrets never appear in error responses (401, 403, 405, 413)", async () => {
    // 401 Missing Token
    const res401 = await request(app).post("/mcp").send({});
    assertNoSecretsInText(res401.text, secrets);

    // 401 Wrong Token
    const resBadToken = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer invalid_secret_value_12345678901234567890")
      .send({});
    assertNoSecretsInText(resBadToken.text, secrets);

    // 403 Forbidden Origin
    const res403 = await request(app)
      .post("/mcp")
      .set("Origin", "https://unauthorized-domain.com")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({});
    assertNoSecretsInText(res403.text, secrets);

    // 405 Method Not Allowed
    const res405 = await request(app).get("/mcp");
    assertNoSecretsInText(res405.text, secrets);

    // 413 Oversized Payload
    const res413 = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send(JSON.stringify({ data: "x".repeat(110 * 1024) }));
    assertNoSecretsInText(res413.text, secrets);
  });

  it("secrets never appear in successful tool responses", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_workspace_summary",
          arguments: {},
        },
      });

    assertNoSecretsInText(res.text, secrets);
  });

  it("secrets never appear in campaign or lead detail responses", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_campaign",
          arguments: { id: "01956fbd-0eb1-72db-a565-82977a586001" },
        },
      });

    assertNoSecretsInText(res.text, secrets);
  });
});

function assertNoSecretsInText(text: string, secretsList: string[]): void {
  for (const secret of secretsList) {
    if (secret && secret.length >= 32) {
      expect(text).not.toContain(secret);
    }
  }
}
