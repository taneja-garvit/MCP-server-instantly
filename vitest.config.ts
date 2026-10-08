import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 10000,
    include: ["tests/**/*.test.ts"],
    env: {
      MOCK_MODE: "true",
      INSTANTLY_API_KEY: "mock_instantly_api_key_test_at_least_32_chars",
      VIEWER_TOKEN: "viewer_test_token_at_least_32_chars_long_1111",
      OPERATOR_TOKEN: "operator_test_token_at_least_32_chars_long_2222",
      ADMIN_TOKEN: "admin_test_token_at_least_32_chars_long_3333",
    },
  },
});
