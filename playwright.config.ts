import { defineConfig } from "@playwright/test";

// Test DB is separate from dev.db so a test run never touches real data.
// Resolved by Prisma relative to prisma/schema.prisma -> prisma/test.db.
process.env.DATABASE_URL = "file:./test.db";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/anthropic-stub.mjs",
      port: 8766,
      reuseExistingServer: false,
    },
    {
      command: "npx next dev -p 3100",
      port: 3100,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: "file:./test.db",
        NEXT_DIST_DIR: ".next-test",
        ANTHROPIC_API_KEY: "test-key-not-real",
        ANTHROPIC_BASE_URL: "http://localhost:8766",
      },
    },
  ],
});
