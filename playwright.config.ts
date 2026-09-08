import { defineConfig } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";

// Test DB is separate from dev.db so a test run never touches real data.
// Resolved by Prisma relative to prisma/schema.prisma -> prisma/test-<uuid>.db.
const databaseUrl = process.env.BASANITE_TEST_DATABASE_URL ?? `file:./test-${randomUUID()}.db`;
if (!/^file:\.\/test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/.test(databaseUrl)) {
  throw new Error("Refusing to use anything except a unique test-<uuid>.db database.");
}
process.env.BASANITE_TEST_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;
const sessionToken = process.env.BASANITE_TEST_SESSION_TOKEN ?? randomBytes(32).toString("base64url");
process.env.BASANITE_TEST_SESSION_TOKEN = sessionToken;

export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/*.test.mjs",
  globalSetup: "./tests/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    storageState: {
      cookies: [{ name: "basanite_session", value: sessionToken, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
      origins: [],
    },
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
        DATABASE_URL: databaseUrl,
        BASANITE_TEST_DATABASE_URL: databaseUrl,
        APP_ORIGIN: "http://localhost:3100",
        NEXT_DIST_DIR: ".next-test",
        ANTHROPIC_API_KEY: "test-key-not-real",
        ANTHROPIC_BASE_URL: "http://localhost:8766",
      },
    },
  ],
});
