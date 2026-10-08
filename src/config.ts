import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env file if present
dotenv.config();

const envSchema = z.object({
  INSTANTLY_API_KEY: z
    .string({
      required_error: "INSTANTLY_API_KEY is required",
    })
    .min(32, "INSTANTLY_API_KEY must be at least 32 characters long"),

  VIEWER_TOKEN: z
    .string({
      required_error: "VIEWER_TOKEN is required",
    })
    .min(32, "VIEWER_TOKEN must be at least 32 characters long"),

  OPERATOR_TOKEN: z
    .string({
      required_error: "OPERATOR_TOKEN is required",
    })
    .min(32, "OPERATOR_TOKEN must be at least 32 characters long"),

  ADMIN_TOKEN: z
    .string({
      required_error: "ADMIN_TOKEN is required",
    })
    .min(32, "ADMIN_TOKEN must be at least 32 characters long"),

  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((val) => {
      if (!val || val.trim() === "") return [];
      const origins = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const origin of origins) {
        if (origin === "*") {
          throw new Error("Wildcard '*' origin is not allowed for security reasons");
        }
      }
      return origins;
    }),

  ENABLE_ADMIN_TOOLS: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1"),

  MOCK_MODE: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1"),

  PORT: z
    .string()
    .optional()
    .default("3000")
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`PORT must be a valid port number between 1 and 65535`);
      }
      return parsed;
    }),

  LOG_LEVEL: z
    .enum(["silent", "trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export type Config = z.infer<typeof envSchema>;

let parsedConfig: Config;

try {
  parsedConfig = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    // Fail fast with clear error descriptions, NEVER logging actual values
    console.error("FATAL: Environment configuration validation failed:");
    for (const issue of error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
  } else if (error instanceof Error) {
    console.error(`FATAL: Environment configuration error: ${error.message}`);
  } else {
    console.error("FATAL: Unknown configuration error during initialization");
  }
  process.exit(1);
}

export const config = parsedConfig;
