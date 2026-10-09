import { defineConfig } from "@playwright/test";
const databaseURL = process.env.E2E_DATABASE_URL;
if (!databaseURL || !new URL(databaseURL).pathname.endsWith("_test"))
  throw new Error("浏览器验证需要独立 E2E_DATABASE_URL，库名以 _test 结尾。");
process.env.E2E_PREFIX ??= `browser-${Date.now()}`;
const emails = [
  "desktop",
  "mobile",
  "learning-desktop",
  "learning-mobile",
  "other-desktop",
  "other-mobile",
]
  .map((device) => `${process.env.E2E_PREFIX}-${device}@example.com`)
  .join(",");
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://localhost:3100", trace: "off" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command:
      "pnpm db:migrate && pnpm content:publish && pnpm dev --hostname 127.0.0.1 --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: databaseURL,
      BETTER_AUTH_URL: "http://localhost:3100",
      BETTER_AUTH_SECRET: "browser-test-secret-at-least-32-characters",
      TESTER_EMAILS: emails,
      DEVELOPMENT_MAIL: "true",
    },
  },
});
