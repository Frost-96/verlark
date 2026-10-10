import { expect, test, vi } from "vitest";
import { createTranscription } from "./server";
import { readConfig } from "../../server/config";
test("识别替身必须显式开启且仅允许开发测试环境，正式配置双重拒绝", () => {
  expect(createTranscription({ development: false }).mode).toBe("unavailable");
  expect(createTranscription({ development: true }).mode).toBe("development");
  vi.stubEnv("NODE_ENV", "production");
  try {
    expect(() => createTranscription({ development: true })).toThrow(
      "正式环境",
    );
    expect(() =>
      readConfig({ NODE_ENV: "production", DEVELOPMENT_TRANSCRIPTION: "true" }),
    ).toThrow("识别替身");
  } finally {
    vi.unstubAllEnvs();
  }
});
