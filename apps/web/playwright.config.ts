import { defineConfig, devices } from "@playwright/test";

// Specs that need the signing secret (stream proxy) read it from the repo-root .env.
try {
  process.loadEnvFile("../../.env");
} catch {
  /* no .env: those specs skip */
}

const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Specs mock the API with page.route, so only the web app has to run.
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
