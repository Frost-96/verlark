import { expect, test, vi } from "vitest";
import { createExpressionFeedback } from "./server";
import { readConfig } from "../../server/config";
test("反馈替身必须显式开启，仅允许开发测试；正式环境和未指定环境双重拒绝", async () => {
  expect(createExpressionFeedback({ development: false }).mode).toBe(
    "unavailable",
  );
  expect(createExpressionFeedback({ development: true }).mode).toBe(
    "development",
  );
  for (const environment of ["production", undefined] as const) {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("DEVELOPMENT_FEEDBACK", "true");
    try {
      expect(() => createExpressionFeedback({ development: true })).toThrow(
        "反馈替身",
      );
      expect(() => readConfig()).toThrow("反馈替身");
    } finally {
      vi.unstubAllEnvs();
    }
  }
});
