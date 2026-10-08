import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

describe("Middleware & Transport Security", () => {
  const app = createApp();

  it("GET /health returns 200 { status: 'ok' } without authentication", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /mcp returns 405 Method Not Allowed with Allow: POST", async () => {
    const res = await request(app).get("/mcp");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.body.error).toBe("Method Not Allowed");
  });

  it("DELETE /mcp returns 405 Method Not Allowed with Allow: POST", async () => {
    const res = await request(app).delete("/mcp");
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.body.error).toBe("Method Not Allowed");
  });

  it("POST /mcp with no token returns 401 with WWW-Authenticate: Bearer", async () => {
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeDefined();
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(res.body.error).toBe("Unauthorized");
  });

  it("POST /mcp with wrong token returns 401 with WWW-Authenticate: Bearer", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer wrong_token_secret_value_12345678901234567890")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
    expect(res.body.error).toBe("Unauthorized");
  });

  it("POST /mcp with bad Origin returns 403 Forbidden", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Origin", "https://unauthorized-origin.com")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
    expect(res.body.message).toBe("Origin not allowed");
  });

  it("POST /mcp with allowed Origin sets exact CORS headers and permits access", async () => {
    const allowedOrigin = config.ALLOWED_ORIGINS[0] || "http://localhost:3000";
    const res = await request(app)
      .options("/mcp")
      .set("Origin", allowedOrigin);

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("POST /mcp with oversized JSON body (> 100kb) returns 413 Payload Too Large", async () => {
    const oversizedPayload = "A".repeat(110 * 1024); // 110kb
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${config.VIEWER_TOKEN}`)
      .send(JSON.stringify({ data: oversizedPayload }));

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("Payload Too Large");
    expect(res.body.message).toContain("100kb");
  });
});
