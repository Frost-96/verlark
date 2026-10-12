import { expect, test, vi } from "vitest";
import { createResendMail } from "./resend";
const settings = {
  apiKey: "test-key",
  from: "login@example.com",
  baseURL: "https://app.example.com",
  recipients: new Set(["owner@example.com"]),
};
const message = {
  to: "owner@example.com",
  kind: "verification" as const,
  url: "https://app.example.com/verify-email?token=secret",
};
test("Resend accepts a single allowlisted verification message with an id", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id: "mail-id" }));
  await createResendMail(settings, transport).send(message);
  expect(transport).toHaveBeenCalledOnce();
  const [url, options] = transport.mock.calls[0]!;
  expect(url).toBe("https://api.resend.com/emails");
  expect(JSON.parse(String(options?.body))).toMatchObject({
    from: settings.from,
    to: [message.to],
    subject: "验证你的 Verlark 邮箱",
  });
});
test("mail boundary refuses non-test recipients and foreign callback origins before network", async () => {
  const transport = vi.fn<typeof fetch>();
  const mail = createResendMail(settings, transport);
  await expect(
    mail.send({ ...message, to: "outsider@example.com" }),
  ).rejects.toThrow();
  await expect(
    mail.send({
      ...message,
      url: "https://evil.example/verify-email?token=secret",
    }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
test.each([401, 429, 500])(
  "provider rejection %i is not success and never retries",
  async (status) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ message: "private provider detail" }, { status }),
      );
    await expect(
      createResendMail(settings, transport).send(message),
    ).rejects.toThrow("邮件服务未确认");
    expect(transport).toHaveBeenCalledOnce();
  },
);
test("a timeout or missing provider id remains failure without a retry", async () => {
  for (const transport of [
    vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout")),
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({})),
  ]) {
    await expect(
      createResendMail(settings, transport).send(message),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  }
});
test("identical messages reuse a non-secret idempotency key; changed token gets a new key", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ id: "accepted" }));
  const mail = createResendMail(settings, transport);
  await mail.send(message);
  await mail.send(message);
  await mail.send({ ...message, url: message.url + "2" });
  const keys = transport.mock.calls.map(([, options]) =>
    new Headers(options?.headers).get("Idempotency-Key"),
  );
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[0]);
});
