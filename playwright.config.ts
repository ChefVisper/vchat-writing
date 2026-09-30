import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 90000,
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30000,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: { args: ["--disable-gpu"] },
  },
  workers: 1,
  reporter: "list",
});
