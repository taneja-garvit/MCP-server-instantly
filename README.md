# Instantly.ai MCP Server

A production-quality, role-based Model Context Protocol (MCP) server for the **Instantly.ai API v2**.

> **Pitch**: *"A small, secure MCP server for Instantly, read-only by default."* Built with Node.js 20+, TypeScript, Express, and the official `@modelcontextprotocol/sdk`. Designed for code clarity, defense-in-depth security, and robust tool ergonomics over feature count.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Clients["MCP Clients"]
        Cursor["Cursor"]
        Claude["Claude Code / Desktop"]
        Inspector["MCP Inspector"]
    end

    subgraph Entrypoints["Server Entrypoints"]
        HTTP["Streamable HTTP (POST /mcp)"]
        Stdio["Stdio (src/stdio.ts)"]
    end

    subgraph Pipeline["Security Middleware Pipeline (Express)"]
        M1["1. Helmet & 100kb Body Limit (413)"]
        M2["2. Origin Check (403 on disallowed, no wildcard)"]
        M3["3. Rate Limiter (Token Hash / IP, 429)"]
        M4["4. Constant-Time Bearer Auth (401 + WWW-Authenticate)"]
    end

    subgraph ServerInstance["Stateless McpServer Instance (per request)"]
        Filter["Two-Layer Role Gating"]
        VTools["Viewer Tools (6 read-only)"]
        OTools["Operator Tools (add_lead, pause_campaign)"]
        ATools["Admin Tools (activate_campaign + confirm)"]
    end

    subgraph ClientLayer["Instantly Client (src/instantly/client.ts)"]
        Fetch["Fetch Wrapper (10s Timeout, Safe Retry for GET)"]
        Mock["Mock DB (MOCK_MODE=true)"]
        LiveAPI["Instantly API v2 (https://api.instantly.ai/api/v2)"]
    end

    Clients -->|Remote HTTP| HTTP
    Clients -->|Local CLI| Stdio
    HTTP --> Pipeline
    Pipeline --> Filter
    Stdio --> Filter
    Filter --> VTools
    Filter --> OTools
    Filter --> ATools
    VTools & OTools & ATools --> Fetch
    Fetch -->|MOCK_MODE=true| Mock
    Fetch -->|MOCK_MODE=false| LiveAPI
```

---

## Tools & Role Permissions

The server implements **9 curated tools**. Each tool specifies exact Zod input schemas, pagination limits (`default: 20, max: 50`), and explicit **MCP Tool Annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

| Tool Name | Role | MCP Annotations | Description & Scope |
| :--- | :--- | :--- | :--- |
| **`list_campaigns`** | `viewer` | `readOnly: true`<br>`destructive: false`<br>`idempotent: true` | Lists cold email campaigns with status, timestamps, and cursor pagination. Does *not* return heavy lead arrays or email bodies. |
| **`get_campaign`** | `viewer` | `readOnly: true`<br>`destructive: false`<br>`idempotent: true` | Retrieves schedule and sequence steps metadata for a campaign without dumping raw HTML bodies. |
| **`get_campaign_analytics`** | `viewer` | `readOnly: true`<br>`destructive: false`<br>`idempotent: true` | Calculates performance metrics (leads, sent, opens, replies, bounces, open rate %, reply rate %). |
| **`list_leads`** | `viewer` | `readOnly: true`<br>`destructive: false`<br>`idempotent: true` | Queries leads via Instantly v2's `POST /api/v2/leads/list`. Truncates text fields (~200 chars) to prevent prompt injection. |
| **`list_email_accounts`** | `viewer` | `readOnly: true`<br>`destructive: false`<br>`idempotent: true` | Reports sender mailbox health, connection state, warmup status, and daily send limits. |
| **`get_workspace_summary`** | `viewer` | `readOnly: true`<br>`destructive: false`<br>`idempotent: true` | **Composite executive summary**: Aggregates campaign status counts, account health breakdown, and total outreach KPIs into ONE compact response. |
| **`add_lead`** | `operator` | `readOnly: false`<br>`destructive: false`<br>`idempotent: false` | Enrolls a new prospect into a campaign or list. Validates email syntax with Zod. Does *not* trigger immediate ad-hoc emails. |
| **`pause_campaign`** | `operator` | `readOnly: false`<br>`destructive: true`<br>`idempotent: true` | Halts outgoing emails for an active campaign during maintenance or deliverability spikes. |
| **`activate_campaign`** | `admin` | `readOnly: false`<br>`destructive: true`<br>`idempotent: true` | Starts campaign delivery. **Triple-gated**: requires `admin` role, `ENABLE_ADMIN_TOOLS=true`, and explicit `confirm: true`. |

---

## Role-Based Access Control (RBAC)

Authentication uses three independent bearer tokens:
1. `VIEWER_TOKEN` (Read-only operations)
2. `OPERATOR_TOKEN` (Read-only + `add_lead`, `pause_campaign`)
3. `ADMIN_TOKEN` (All tools, including `activate_campaign`)

### Two-Layer Enforcement (Defense in Depth)
1. **Layer 1: Filter `tools/list`**: Only tools permitted for the token's role are registered on the `McpServer` instance. LLMs never discover tools outside their scope.
2. **Layer 2: In-Handler Guard**: Every tool callback re-verifies `isRoleAuthorized(sessionRole, requiredRole)`. If an unauthorized client attempts a guessed `tools/call`, the request is rejected with an error.

---

## Security Decisions & Architectural Tradeoffs

### 1. Constant-Time Authentication with SHA-256 Pre-Hashing
* **Decision**: Comparing tokens with `crypto.timingSafeEqual` directly will throw a runtime error in Node.js if the candidate string and secret string differ in length.
* **Implementation**: We compute the SHA-256 digest of both the candidate token and the stored secret first. This guarantees both buffers are strictly 32 bytes, allowing safe constant-time comparison that eliminates both timing attacks and length disclosure.

### 2. Static Bearer Tokens vs. OAuth 2.1
* **Tradeoff**: We chose static bearer tokens as a deliberate, robust simplification for phase 1 deployment.
* **Upgrade Path**: In a multi-tenant enterprise deployment, the upgrade path is **OAuth 2.1 with Proof Key for Code Exchange (PKCE)** and scoped JWT access tokens issued by an identity provider (e.g. Auth0, Okta, or Instantly OAuth). The middleware interface (`req.userRole`) is already decoupled and ready to accept JWT claims.

### 3. Stateless Streamable HTTP Transport
* **Decision**: The server runs in **stateless mode** (`sessionIdGenerator: undefined`).
* **Rationale**: Multi-instance deployments (such as Render web service autoscaling) fail with stateful HTTP transports unless sticky sessions or centralized Redis session stores are implemented. Stateless mode handles each HTTP request as an independent JSON-RPC turn, enabling horizontal scaling, zero-downtime rolling deploys, and zero session-leak vulnerabilities.

### 4. Strict Origin Verification (No Wildcard CORS)
* If an `Origin` header is present, it is checked against `ALLOWED_ORIGINS`. Disallowed origins receive `403 Forbidden`.
* Allowed origins receive exact header reflection (`Access-Control-Allow-Origin: <origin>`). Wildcard `*` CORS is strictly prohibited.
* Non-browser clients (MCP Inspector, Cursor, Claude Code, curl) do not transmit an `Origin` header and are permitted through.

### 5. Rate Limiting via Token Digest
* Rate limits are tracked using the SHA-256 hash of the bearer token (with fallback to client IP).
* This ensures raw authorization secrets are never stored in memory cache keys.

### 6. Prompt Injection Defense via String Truncation
* Untrusted strings from leads and campaigns (names, notes, email subjects) are sanitized and truncated to ~200 characters before inclusion in tool responses.
* Upstream API errors are sanitized via `formatActionableErrorMessage()` — stack traces and raw upstream bodies are never exposed to LLM context.

### 7. Structured Audit Logging
* Built with `pino`, configured with automated redaction of Authorization headers, API keys, and tokens.
* Dedicated audit helper logs one structured JSON line per tool execution: `timestamp`, `role`, `tool`, `success/failure`, and `durationMs`.
* **Lead emails and message bodies are never logged.**

---

## Environment Configuration

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `INSTANTLY_API_KEY` | Yes | - | Instantly v2 API Key (minimum 32 characters) |
| `VIEWER_TOKEN` | Yes | - | Static bearer token for Viewer role (minimum 32 chars) |
| `OPERATOR_TOKEN` | Yes | - | Static bearer token for Operator role (minimum 32 chars) |
| `ADMIN_TOKEN` | Yes | - | Static bearer token for Admin role (minimum 32 chars) |
| `ALLOWED_ORIGINS` | No | `""` | Comma-separated list of allowed browser origins |
| `ENABLE_ADMIN_TOOLS`| No | `false`| Enable destructive admin operations (`activate_campaign`) |
| `MOCK_MODE` | No | `false`| When `true`, returns realistic simulated data |
| `PORT` | No | `3000` | HTTP port to listen on (Render overrides this automatically) |
| `LOG_LEVEL` | No | `info` | Logging verbosity (`info`, `debug`, `warn`, `error`, `silent`) |

---

## Local Development & Testing

### 1. Build and Run Server Locally
```bash
npm run build
npm start
# or during active development:
npm run dev
```

### 2. Verify Over Local Streamable HTTP
Run the built-in live HTTP verification script (tests `/health`, `POST /mcp` initialize, `tools/list`, and tool invocations):
```bash
npm run test:live
```

### 3. Run Automated Vitest Suite (20 Tests)
```bash
npm test
```

### 4. Connect via MCP Inspector
**Option A: Over Stdio (Admin Mode)**
```bash
npx @modelcontextprotocol/inspector node dist/stdio.js
```

**Option B: Over Streamable HTTP**
Start the server with `npm start`, then in a new terminal:
```bash
npx @modelcontextprotocol/inspector
```
In the Inspector web interface:
* **Transport Type**: `Streamable HTTP`
* **URL**: `http://localhost:3000/mcp`
* **Headers**: `Authorization: Bearer <YOUR_VIEWER_OR_ADMIN_TOKEN>`

---

## Client Integration Guides

### Cursor
Add to your project's `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "instantly": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer your_viewer_or_operator_token_here_32chars"
      }
    }
  }
}
```
*(For production, replace `http://localhost:3000/mcp` with your Render service URL, e.g., `https://instantly-mcp.onrender.com/mcp`).*

### Claude Code / Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "instantly": {
      "command": "node",
      "args": ["/absolute/path/to/instantly-mcp-server/dist/stdio.js"],
      "env": {
        "INSTANTLY_API_KEY": "your_instantly_api_key_here",
        "MOCK_MODE": "false"
      }
    }
  }
}
```

---

## Deploying to Render

This repository includes a production-ready [`render.yaml`](file:///Users/garvit/Desktop/projects/MCP%20server%20instantly/render.yaml) blueprint with **zero secrets committed**.

### Step-by-Step Deployment:
1. Initialize git and push to your GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "feat: Instantly.ai MCP Server"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
2. Open the [Render Dashboard](https://dashboard.render.com).
3. Click **New +** ➔ **Blueprint**.
4. Select your GitHub repository.
5. Render reads `render.yaml` and securely prompts you for:
   * `INSTANTLY_API_KEY`
   * `VIEWER_TOKEN`
   * `OPERATOR_TOKEN`
   * `ADMIN_TOKEN`
6. Click **Apply**. Render will automatically build (`npm ci && npm run build`), start (`node dist/server.js`), and monitor the health check at `/health`.

---

## Known Limitations & Boundaries
* **Read-Only by Default**: The server intentionally defaults to read-only semantics. Write and activation tools require elevated roles and explicit confirmation.
* **Bulk Operations Excluded**: Bulk CSV uploads and multi-account mass migrations are deliberately omitted to preserve LLM response determinism and prevent unintended quota exhaustion.
* **Upstream Rate Limits**: Instantly v2 enforces workspace-wide rate limits (100 req/sec, 6,000 req/min). The server's client automatically retries transient 429s for GET requests up to 2 times, but prolonged rate limiting will return clear actionable error messages to the LLM.
