#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "./logger.js";
import { createMcpServer } from "./tools/index.js";

/**
 * Stdio entrypoint for local development, debugging, and MCP Inspector.
 * Uses admin role by default so all tools can be tested and inspected.
 *
 * NOTE: All diagnostics and logs MUST go to stderr (or logger configured with stderr),
 * because stdout is exclusively dedicated to the JSON-RPC framing protocol.
 */
async function main() {
  logger.info("Initializing Instantly MCP server in stdio mode (role=admin)...");

  // Create server with admin role
  const server = createMcpServer("admin");

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to stdio transport
  await server.connect(transport);

  logger.info("Instantly MCP server connected to stdio transport. Ready for MCP requests.");

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, closing stdio server...`);
    try {
      await server.close();
    } catch (err) {
      logger.error({ err }, "Error during stdio server close");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  // Write fatal errors to stderr
  console.error("Fatal error starting stdio MCP server:", err);
  process.exit(1);
});
