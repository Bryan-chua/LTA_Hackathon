import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    { name: "mobile-320", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 760 } } },
    { name: "mobile-360", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 } } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
