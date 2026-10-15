import { expect, test } from "vitest";
import { readConfig } from "./config";
const valid: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://user:password@localhost/new_db",
  BETTER_AUTH_SECRET: "local-test-secret-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  TESTER_EMAILS: "learner@example.com",
  NODE_ENV: "test",
};
test("隔离恢复期间拒绝启动业务服务，不能用旧会话访问恢复中的数据库", () => {
  expect(() =>
    readConfig({ ...valid, MEDIA_RECOVERY_OFFLINE: "true" }),
  ).toThrow("恢复隔离中");
});
test("正式环境拒绝开发邮件替身", () => {
  expect(() =>
    readConfig({ ...valid, NODE_ENV: "production", DEVELOPMENT_MAIL: "true" }),
  ).toThrow("正式环境不能启用开发邮件替身");
});
test("读取 DATABASE_URL，缺失或无效时不泄露连接凭据", () => {
  expect(readConfig(valid).databaseURL).toBe(valid.DATABASE_URL);
  expect(() => readConfig({ ...valid, DATABASE_URL: undefined })).toThrow(
    "请配置 DATABASE_URL",
  );
  expect(() =>
    readConfig({ ...valid, DATABASE_URL: "invalid://user:top-secret@host" }),
  ).toThrow("数据库连接配置格式不正确");
});
test("正式环境拒绝开发录音文件 Adapter", () => {
  expect(() =>
    readConfig({
      ...valid,
      NODE_ENV: "production",
      DEVELOPMENT_RECORDINGS: "true",
    }),
  ).toThrow("正式环境不能启用开发录音文件 Adapter");
});

test("私有录音配置独立于新增上传开关，缺少清理凭据或同时启用替身时拒绝启动", () => {
  expect(readConfig(valid).recordingUploadsEnabled).toBe(false);
  expect(() =>
    readConfig({ ...valid, PRIVATE_RECORDINGS_ENABLED: "true" }),
  ).toThrow("私有录音需要");
  expect(() =>
    readConfig({ ...valid, RECORDING_UPLOADS_ENABLED: "true" }),
  ).toThrow("必须配置私有录音");
  const configured = {
    ...valid,
    PRIVATE_RECORDINGS_ENABLED: "true",
    BLOB_READ_WRITE_TOKEN: "test-only-token",
    CRON_SECRET: "test-only-maintenance-secret-32-characters",
  };
  expect(readConfig(configured).recordingUploadsEnabled).toBe(false);
  expect(() =>
    readConfig({ ...configured, DEVELOPMENT_RECORDINGS: "true" }),
  ).toThrow("不能同时");
});
test("真实识别须显式开启、配置北京凭据和已核实免费停止策略，缺失时失败关闭", () => {
  expect(readConfig(valid).bailianTranscription).toBe(false);
  expect(() =>
    readConfig({ ...valid, BAILIAN_TRANSCRIPTION_ENABLED: "true" }),
  ).toThrow("真实识别");
  const enabled = {
    ...valid,
    PRIVATE_RECORDINGS_ENABLED: "true",
    BLOB_READ_WRITE_TOKEN: "test",
    CRON_SECRET: "x".repeat(32),
    BAILIAN_TRANSCRIPTION_ENABLED: "true",
    DASHSCOPE_API_KEY: "test",
    BAILIAN_ASR_FREE_ONLY_VERIFIED: "true",
    BAILIAN_ASR_ALLOWANCE_SECONDS: "120",
    BAILIAN_ASR_FREE_EXPIRES_AT: "2099-01-01T00:00:00Z",
  };
  expect(readConfig(enabled).recognitionPolicy).toMatchObject({
    allowanceSeconds: 120,
    budgetKey: "bailian-beijing-qwen-audio-3.0-asr-flash",
  });
  expect(() =>
    readConfig({ ...enabled, DEVELOPMENT_TRANSCRIPTION: "true" }),
  ).toThrow("真实识别");
});

test("真实识别与反馈分别显式开启，合并配置保留各自额度策略", () => {
  const configured = {
    ...valid,
    PRIVATE_RECORDINGS_ENABLED: "true",
    BLOB_READ_WRITE_TOKEN: "test",
    CRON_SECRET: "x".repeat(32),
    DASHSCOPE_API_KEY: "test",
    DASHSCOPE_API_HOST: "ws-test.cn-beijing.maas.aliyuncs.com",
    BAILIAN_ASR_FREE_ONLY_VERIFIED: "true",
    BAILIAN_ASR_ALLOWANCE_SECONDS: "240",
    BAILIAN_ASR_FREE_EXPIRES_AT: "2099-01-01T00:00:00Z",
    FEEDBACK_FREE_ONLY_VERIFIED: "true",
    FEEDBACK_FREE_MODEL_VERIFIED: "qwen3.8-max-0902",
    FEEDBACK_FREE_TOKEN_BUDGET: "10000",
    FEEDBACK_FREE_UNTIL: "2099-01-01T00:00:00Z",
    FEEDBACK_TRIAL_ID: "test-window",
    FEEDBACK_TRIAL_LEARNER_ID: "owner",
    FEEDBACK_TRIAL_CONTENT_VERSION_IDS: Array.from({ length: 6 }, () =>
      crypto.randomUUID(),
    ).join(","),
    FEEDBACK_TRIAL_STARTS_AT: "2098-12-31T22:00:00Z",
  };
  const asrOnly = readConfig({
    ...configured,
    BAILIAN_TRANSCRIPTION_ENABLED: "true",
  });
  expect(asrOnly.realFeedback).toBeUndefined();
  expect(asrOnly.recognitionPolicy?.allowanceSeconds).toBe(240);
  const feedbackOnly = readConfig({
    ...configured,
    REAL_FEEDBACK_ENABLED: "true",
  });
  expect(feedbackOnly.bailianTranscription).toBe(false);
  expect(feedbackOnly.recognitionPolicy).toBeUndefined();
  expect(feedbackOnly.realFeedback?.model).toBe("qwen3.8-max-0902");
  const both = readConfig({
    ...configured,
    BAILIAN_TRANSCRIPTION_ENABLED: "true",
    REAL_FEEDBACK_ENABLED: "true",
  });
  expect(both.recognitionPolicy?.allowanceSeconds).toBe(240);
  expect(both.realFeedback?.freeTokenBudget).toBe(10000);
});
