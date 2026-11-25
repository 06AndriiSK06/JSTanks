import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
  },
  webServer: {
    command: "node --import tsx server/src/index.ts",
    port: 3100,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "3100",
      STATIC_DIR: "client/dist",
    },
  },
});
