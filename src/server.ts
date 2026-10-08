import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      mockMode: config.MOCK_MODE,
      adminToolsEnabled: config.ENABLE_ADMIN_TOOLS,
      allowedOriginsCount: config.ALLOWED_ORIGINS.length,
    },
    `Instantly MCP server listening on port ${config.PORT} (Streamable HTTP)`
  );
});

// Graceful shutdown handling
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, gracefully shutting down server...`);
  server.close(() => {
    logger.info("HTTP server closed cleanly.");
    process.exit(0);
  });

  // Force close after 10s if connections refuse to terminate
  setTimeout(() => {
    logger.error("Forcing shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
