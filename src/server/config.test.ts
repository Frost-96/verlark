import { expect, test } from "vitest";
import { readConfig } from "./config";
const valid: NodeJS.ProcessEnv = {
  VERLARK_DATABASE_URL: "postgresql://user:password@localhost/new_db",
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
test("不回退到旧 DATABASE_URL，错误不泄露连接凭据", () => {
  expect(() =>
    readConfig({
      ...valid,
      VERLARK_DATABASE_URL: undefined,
      DATABASE_URL: valid.VERLARK_DATABASE_URL,
    }),
  ).toThrow("请配置 VERLARK_DATABASE_URL");
  expect(() =>
    readConfig({
      ...valid,
      VERLARK_DATABASE_URL: "invalid://user:top-secret@host",
    }),
  ).toThrow("数据库连接配置格式不正确");
});
