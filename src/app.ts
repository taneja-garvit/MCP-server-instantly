import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerAuthMiddleware } from "./middleware/auth.js";
import { originCheckMiddleware } from "./middleware/origin.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { createMcpServer } from "./tools/index.js";
import { logger } from "./logger.js";
import type { UserRole } from "./types/roles.js";

/**
 * Creates and configures the Express application with the strict security middleware pipeline.
 *
 * PIPELINE ORDER:
 * 1. helmet, 100kb JSON body limit (413 on exceed)
 * 2. Origin check (403 on disallowed origin; non-browser clients without Origin allowed; no wildcard)
 * 3. Rate limit (per token hash, fallback IP, 429 on exceed)
 * 4. Bearer auth (constant-time token comparison, WWW-Authenticate: Bearer, attaches userRole)
 * 5. MCP handler (POST /mcp stateless Streamable HTTP; GET/DELETE /mcp return 405)
 */
export function createApp(): express.Application {
  const app = express();

  // Disable x-powered-by header
  app.disable("x-powered-by");

  // Trust proxy for Render / load-balancers (first hop)
  app.set("trust proxy", 1);

  // ----------------------------------------------------
  // STEP 1: Helmet & 100kb JSON body limit
  // ----------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: false, // API server does not serve HTML UI
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: "100kb" }));

  // Immediate catch for oversized payload error (413)
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && (err.status === 413 || err.type === "entity.too.large")) {
      res.status(413).json({
        error: "Payload Too Large",
        message: "Request body exceeds 100kb limit",
      });
      return;
    }
    next(err);
  });

  // ----------------------------------------------------
  // STEP 2: Origin check & strict CORS
  // ----------------------------------------------------
  app.use(originCheckMiddleware);

  // ----------------------------------------------------
  // STEP 3: Rate limiting
  // ----------------------------------------------------
  app.use(rateLimitMiddleware);

  // ----------------------------------------------------
  // Unauthenticated Health Check: GET /health
  // ----------------------------------------------------
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  // ----------------------------------------------------
  // Method Not Allowed handlers for /mcp
  // ----------------------------------------------------
  app.all("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "DELETE") {
      res.setHeader("Allow", "POST");
      res.status(405).json({
        error: "Method Not Allowed",
        message: `HTTP ${req.method} is not supported on /mcp. Use POST for Streamable HTTP.`,
      });
      return;
    }
    next();
  });

  // ----------------------------------------------------
  // STEP 4: Bearer Authentication
  // ----------------------------------------------------
  app.use(bearerAuthMiddleware);

  // ----------------------------------------------------
  // STEP 5: MCP Handler (POST /mcp) - STATELESS Streamable HTTP
  // ----------------------------------------------------
  app.post("/mcp", async (req: Request, res: Response, next: NextFunction) => {
    const role: UserRole = req.userRole || "viewer";

    // Ensure Accept header includes text/event-stream and application/json
    // as mandated by the MCP Streamable HTTP specification
    const currentAccept = req.headers.accept || "";
    if (
      !currentAccept.includes("text/event-stream") ||
      !currentAccept.includes("application/json")
    ) {
      req.headers.accept = "application/json, text/event-stream";
    }

    // STATELESS: Create a fresh server and transport per request, without session IDs
    const server = createMcpServer(role);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, "Error handling MCP request over Streamable HTTP");
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal Server Error",
          message: "Failed to process MCP request",
        });
      }
    } finally {
      // Clean up server instance when request completes
      res.on("finish", async () => {
        try {
          await server.close();
        } catch {
          // ignore cleanup errors
        }
      });
    }
  });

  // Catch-all 404 for unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: "Not Found",
      message: "The requested route does not exist",
    });
  });

  // Final centralized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled server error");
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: "An unexpected error occurred",
      });
    }
  });

  return app;
}
