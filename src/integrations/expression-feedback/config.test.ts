import { expect, test } from "vitest";
import { readFeedbackConfig } from "./config";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  REAL_FEEDBACK_ENABLED: "true",
  DASHSCOPE_API_KEY: "test",
  DASHSCOPE_API_HOST: "ws-test.cn-beijing.maas.aliyuncs.com",
  FEEDBACK_FREE_TOKEN_BUDGET: "10000",
  FEEDBACK_FREE_UNTIL: "2020-01-01T00:00:00Z",
  FEEDBACK_TRIAL_ID: "test-window",
  FEEDBACK_TRIAL_LEARNER_ID: "owner",
  FEEDBACK_TRIAL_CONTENT_VERSION_IDS: Array.from({ length: 6 }, () =>
    crypto.randomUUID(),
  ).join(","),
  FEEDBACK_TRIAL_STARTS_AT: "2019-12-31T22:00:00Z",
  FEEDBACK_FREE_ONLY_VERIFIED: "true",
  FEEDBACK_FREE_MODEL_VERIFIED: "qwen3.8-max-0902",
};
test("expired trial still composes services; generation owns the expiry stop", () => {
  expect(readFeedbackConfig(env)?.freeUntil.toISOString()).toBe(
    "2020-01-01T00:00:00.000Z",
  );
});
test("malformed expiry remains invalid configuration", () => {
  expect(() =>
    readFeedbackConfig({ ...env, FEEDBACK_FREE_UNTIL: "invalid" }),
  ).toThrow();
});

test("switching model requires its own explicit free-only verification", () => {
  expect(readFeedbackConfig(env)?.model).toBe("qwen3.8-max-0902");
  for (const override of [
    { FEEDBACK_MODEL: "unknown-model" },
    { FEEDBACK_MODEL: "qwen3.8-max-0902", FEEDBACK_FREE_MODEL_VERIFIED: "" },
    {
      FEEDBACK_MODEL: "qwen3.8-max-0902",
      FEEDBACK_FREE_MODEL_VERIFIED: "qwen3.7-flash-2026-07-15",
    },
  ])
    expect(() => readFeedbackConfig({ ...env, ...override })).toThrow();
  expect(
    readFeedbackConfig({
      ...env,
      FEEDBACK_MODEL: "qwen3.8-max-0902",
      FEEDBACK_FREE_MODEL_VERIFIED: "qwen3.8-max-0902",
    })?.model,
  ).toBe("qwen3.8-max-0902");
});

test("real feedback fails closed without a single-account bounded trial", () => {
  for (const override of [
    { FEEDBACK_TRIAL_ID: "" },
    { FEEDBACK_TRIAL_LEARNER_ID: "" },
    { FEEDBACK_TRIAL_CONTENT_VERSION_IDS: "" },
    {
      FEEDBACK_TRIAL_CONTENT_VERSION_IDS: Array(6)
        .fill(crypto.randomUUID())
        .join(","),
    },
    { FEEDBACK_TRIAL_STARTS_AT: "invalid" },
    { FEEDBACK_TRIAL_STARTS_AT: "2019-12-31T21:59:59Z" },
    { FEEDBACK_TRIAL_STARTS_AT: "2020-01-01T00:00:00Z" },
  ])
    expect(() => readFeedbackConfig({ ...env, ...override })).toThrow();
  expect(
    readFeedbackConfig({ NODE_ENV: "test", REAL_FEEDBACK_ENABLED: "false" }),
  ).toBeUndefined();
});
