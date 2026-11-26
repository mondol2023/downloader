import { defineConfig, devices } from "@playwright/test";

// Specs that need the signing secret (stream proxy) read it from the repo-root .env.
try {
  process.loadEnvFile("../../.env");
} catch {
  /* no .env: those specs skip */
}

const PORT = Number(process.env.E2E_PORT ?? 3000);
const CMS_STUB_PORT = Number(process.env.E2E_CMS_STUB_PORT ?? 4010);

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
    // cms-publish.spec runs a stub API on this port; Next's server-side fetches can't be mocked with page.route.
    env: {
      API_INTERNAL_URL: `http://localhost:${CMS_STUB_PORT}`,
      CMS_ASSET_ORIGIN: `http://localhost:${CMS_STUB_PORT}/api/v1/cms/assets`,
      REVALIDATE_SECRET: "e2e-revalidate-secret-0123456789",
    },
    timeout: 120_000,
  },
});
