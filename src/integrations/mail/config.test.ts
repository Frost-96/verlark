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

const qqEnv = {
  ...env,
  MAIL_PROVIDER: "qq-smtp",
  MAIL_FROM: "sender@qq.com",
  QQ_SMTP_USER: "sender@qq.com",
  QQ_SMTP_AUTH_CODE: "test-code",
  RESEND_API_KEY: "",
  MAIL_FREE_PLAN_CONFIRMED: "false",
};
test("QQ uses all allowlisted recipients without a Resend domain or key", () => {
  expect(
    readMailConfig(
      qqEnv,
      "https://app.example.com",
      new Set(["other@gmail.com"]),
    ),
  ).toMatchObject({
    provider: "qq-smtp",
    from: "sender@qq.com",
    recipients: new Set(["other@gmail.com"]),
  });
});
test("QQ missing credentials, mismatched sender and unknown provider fail closed", () => {
  for (const override of [
    { QQ_SMTP_AUTH_CODE: "" },
    { QQ_SMTP_AUTH_CODE: "a\nb" },
    { QQ_SMTP_USER: "sender@gmail.com" },
    { MAIL_FROM: "other@qq.com" },
    { DEVELOPMENT_MAIL: "true" },
    { MAIL_PROVIDER: "unknown" },
  ]) {
    expect(() =>
      readMailConfig(
        { ...qqEnv, ...override },
        "https://app.example.com",
        new Set(["other@gmail.com"]),
      ),
    ).toThrow();
  }
  expect(() =>
    readMailConfig(qqEnv, "https://app.example.com", new Set()),
  ).toThrow();
  expect(
    readMailConfig(
      { ...qqEnv, MAIL_ENABLED: "false", QQ_SMTP_AUTH_CODE: "" },
      "https://app.example.com",
      new Set(),
    ),
  ).toBeUndefined();
});
