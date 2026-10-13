import { defineConfig } from "@playwright/test";
import local from "./playwright.config";
import { deploymentURL } from "./scripts/deployment-url";

export default defineConfig({
  ...local,
  use: { ...local.use, baseURL: deploymentURL(process.env.DEPLOYMENT_URL) },
  // Run the same assertions against the actual host, with no local fallback.
  webServer: undefined,
  // Keep this separate: Playwright clears the local suite's whole output folder.
  outputDir: "test-results-deployed",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/deployed" }]],
});
