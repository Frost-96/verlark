import { expect, test, vi } from "vitest";
import { createQQMail } from "./qq-smtp";

const settings = {
  from: "sender@qq.com",
  user: "sender@qq.com",
  authorizationCode: "private-code",
  baseURL: "https://app.example.com",
  recipients: new Set(["tester@gmail.com"]),
};
const message = {
  to: "tester@gmail.com",
  kind: "verification" as const,
  url: "https://app.example.com/verify-email?token=secret",
};
function setup() {
  const client = {
    sendMail: vi.fn().mockResolvedValue({
      accepted: [message.to],
      rejected: [],
      response: "250 queued",
    }),
    close: vi.fn(),
  };
  const factory = vi.fn(() => client);
  return { client, factory, mail: createQQMail(settings, factory) };
}
test("QQ authenticates over verified TLS and sends exactly one recipient", async () => {
  const { client, factory, mail } = setup();
  await mail.send(message);
  expect(factory).toHaveBeenCalledWith(
    expect.objectContaining({
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      auth: { user: settings.user, pass: settings.authorizationCode },
      debug: false,
    }),
  );
  expect(client.sendMail).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      envelope: { from: settings.from, to: [message.to] },
      subject: "验证你的 Verlark 邮箱",
    }),
  );
  expect(client.close).toHaveBeenCalledOnce();
});
test("QQ password recovery uses the reset template", async () => {
  const { client, mail } = setup();
  await mail.send({
    ...message,
    kind: "password-reset",
    url: "https://app.example.com/reset-password?token=reset",
  });
  expect(client.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      subject: "重置你的 Verlark 密码",
      text: expect.stringContaining("30 分钟"),
    }),
  );
});
test("invalid recipient, header injection, origin, credentials, path and missing token never open SMTP", async () => {
  const { mail, factory } = setup();
  for (const override of [
    { to: "outsider@gmail.com" },
    { to: "tester@gmail.com\r\nBcc: outsider@gmail.com" },
    { url: "https://evil.example/verify-email?token=secret" },
    { url: "https://user:pass@app.example.com/verify-email?token=secret" },
    { url: "https://app.example.com/reset-password?token=secret" },
    { url: "https://app.example.com/verify-email" },
  ])
    await expect(mail.send({ ...message, ...override })).rejects.toThrow();
  expect(factory).not.toHaveBeenCalled();
});
test.each([
  { accepted: [], rejected: [message.to], response: "550 rejected" },
  { accepted: ["wrong@gmail.com"], rejected: [], response: "250 queued" },
  { accepted: [message.to], rejected: [], response: "451 try later" },
])("unconfirmed delivery is failure with no retry", async (result) => {
  const { mail, client } = setup();
  client.sendMail.mockResolvedValue(result);
  await expect(mail.send(message)).rejects.toThrow("邮件服务未确认接收");
  expect(client.sendMail).toHaveBeenCalledOnce();
  expect(client.close).toHaveBeenCalledOnce();
});
test("authentication errors and timeouts are redacted and never retried", async () => {
  for (const detail of ["535 private-code", "ETIMEDOUT token=secret"]) {
    const { mail, client } = setup();
    client.sendMail.mockRejectedValue(new Error(detail));
    await expect(mail.send(message)).rejects.toThrow(
      /^邮件服务未确认接收，请稍后重新申请。$/,
    );
    expect(client.sendMail).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  }
});
