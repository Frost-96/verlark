import { expect, test } from "vitest";
import { readConfig } from "./config";
const valid: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://user:password@localhost/new_db",
  BETTER_AUTH_SECRET: "local-test-secret-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  TESTER_EMAILS: "learner@example.com",
  NODE_ENV: "test",
};
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
