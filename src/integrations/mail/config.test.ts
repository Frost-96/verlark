import { expect, test } from "vitest";
import { readMailConfig } from "./config";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  MAIL_ENABLED: "true",
  RESEND_API_KEY: "test-key",
  MAIL_FROM: "onboarding@resend.dev",
  MAIL_FREE_PLAN_CONFIRMED: "true",
  MAIL_TEST_OWNER: "owner@example.com",
};
test("unverified domain restricts sending to the authorized owner", () => {
  expect(
    readMailConfig(
      env,
      "https://app.example.com",
      new Set(["owner@example.com", "other@example.com"]),
    )?.recipients,
  ).toEqual(new Set(["owner@example.com"]));
});
test("real mail fails closed without credentials or free plan confirmation", () => {
  for (const override of [
    { RESEND_API_KEY: "" },
    { MAIL_FREE_PLAN_CONFIRMED: "false" },
    { MAIL_TEST_OWNER: "" },
    { DEVELOPMENT_MAIL: "true" },
    { MAIL_DOMAIN_VERIFIED: "true" },
  ])
    expect(() =>
      readMailConfig(
        { ...env, ...override },
        "https://app.example.com",
        new Set(["owner@example.com"]),
      ),
    ).toThrow();
});
