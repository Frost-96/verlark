import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../db/client";
import { handleIdentityRequest } from "../../app/api/auth/http";
import { createIdentity } from "./server";
import { createMailAdapter } from "../../integrations/mail/server";
import type { MailMessage } from "../../integrations/mail/contracts";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error(
    "需要明确的独立 TEST_DATABASE_URL，库名须以 _test 结尾且不同于开发库。",
  );
const connection = connectDatabase(url);
const messages: MailMessage[] = [];
const allowedEmails = new Set<string>();
const config = {
  databaseURL: url,
  secret: "test-only-secret-with-at-least-32-characters",
  baseURL: "http://localhost:3000",
  allowedEmails,
  developmentMail: true,
  production: false,
};
const mail = {
  send: async (message: MailMessage) => {
    messages.push(message);
  },
};
const identity = createIdentity(connection.db, config, mail);
const secondInstance = createIdentity(connection.db, config, mail);
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
afterAll(() => connection.close());
const password = "valid-password-123";
function request(
  path: string,
  body?: object,
  cookie?: string,
  instance = identity,
) {
  return handleIdentityRequest(
    new Request(`http://localhost:3000/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    instance,
  );
}
function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
function mailToken(email: string, kind: MailMessage["kind"]) {
  const message = messages.findLast(
    (item) => item.to === email && item.kind === kind,
  );
  expect(message).toBeDefined();
  return new URL(message!.url).searchParams.get("token")!;
}
async function register() {
  const email = `learner-${crypto.randomUUID()}@example.com`;
  allowedEmails.add(email);
  expect(
    (await request("sign-up/email", { email, password, name: "学习者" }))
      .status,
  ).toBe(200);
  return email;
}
async function verifiedAccount() {
  const email = await register();
  expect(
    (await request(`verify-email?token=${mailToken(email, "verification")}`))
      .status,
  ).toBe(200);
  return email;
}
async function login(email: string, usingPassword = password) {
  const response = await request("sign-in/email", {
    email,
    password: usingPassword,
  });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

test("名单外邮箱被拒绝，匿名和伪造用户标识不能取得身份", async () => {
  const response = await request("sign-up/email", {
    email: "outsider@example.com",
    password,
    name: "名单外",
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    message: "该邮箱不在测试名单中，请联系维护者。",
  });
  expect(
    await identity.getCurrentLearner(new Headers({ "x-user-id": "forged" })),
  ).toBeNull();
  expect((await request("revoke-sessions", { userId: "forged" })).status).toBe(
    401,
  );
});

test("名单内用户必须验证邮箱；验证链接只能使用一次，退出后旧会话失效", async () => {
  const email = await register();
  expect((await request("sign-in/email", { email, password })).status).toBe(
    403,
  );
  const token = mailToken(email, "verification");
  expect((await request(`verify-email?token=${token}`)).status).toBe(200);
  expect((await request(`verify-email?token=${token}`)).status).toBe(400);
  const cookie = await login(email);
  expect(
    (await identity.getCurrentLearner(new Headers({ cookie })))?.email,
  ).toBe(email);
  expect((await request("sign-out", {}, cookie)).status).toBe(200);
  expect(await identity.getCurrentLearner(new Headers({ cookie }))).toBeNull();
  expect((await request("revoke-sessions", {}, cookie)).status).toBe(401);
});

test("密码恢复使旧密码和所有旧会话失效，重置链接只能使用一次", async () => {
  const email = await verifiedAccount();
  const cookie = await login(email);
  expect(
    (
      await request("request-password-reset", {
        email,
        redirectTo: "/reset-password",
      })
    ).status,
  ).toBe(200);
  const token = mailToken(email, "password-reset");
  expect(
    (
      await request("reset-password", {
        token,
        newPassword: "new-password-456",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request("reset-password", {
        token,
        newPassword: "different-password-789",
      })
    ).status,
  ).toBe(400);
  expect((await request("sign-in/email", { email, password })).status).toBe(
    401,
  );
  expect(await identity.getCurrentLearner(new Headers({ cookie }))).toBeNull();
  await login(email, "new-password-456");
});

test("两个服务实例同时消费验证及重置链接均只成功一次", async () => {
  const email = await register();
  const token = mailToken(email, "verification");
  const results = await Promise.all([
    request(`verify-email?token=${token}`),
    request(
      `verify-email?token=${token}`,
      undefined,
      undefined,
      secondInstance,
    ),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
  await request("request-password-reset", { email });
  const reset = mailToken(email, "password-reset");
  const resets = await Promise.all([
    request("reset-password", {
      token: reset,
      newPassword: "concurrent-password-123",
    }),
    request(
      "reset-password",
      { token: reset, newPassword: "concurrent-password-123" },
      undefined,
      secondInstance,
    ),
  ]);
  expect(resets.map((result) => result.status).sort()).toEqual([200, 400]);
});

test("无效和过期令牌不能验证邮箱或重置密码", async () => {
  expect((await request("verify-email?token=invalid")).status).toBe(400);
  expect(
    (
      await request("reset-password", {
        token: "invalid",
        newPassword: password,
      })
    ).status,
  ).toBe(400);
  const email = await register();
  const token = mailToken(email, "verification");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 3601_000);
    expect((await request(`verify-email?token=${token}`)).status).toBe(400);
  } finally {
    vi.useRealTimers();
  }
  // A verified second account isolates password expiry from email verification.
  const verified = await verifiedAccount();
  await request("request-password-reset", { email: verified });
  const reset = mailToken(verified, "password-reset");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 1801_000);
    expect(
      (
        await request("reset-password", {
          token: reset,
          newPassword: "expired-password-123",
        })
      ).status,
    ).toBe(400);
  } finally {
    vi.useRealTimers();
  }
  await login(verified);
});

test("退出所有设备只撤销当前账号，伪造用户标识不能串到另一个账号", async () => {
  const a = await verifiedAccount();
  const b = await verifiedAccount();
  const aFirst = await login(a);
  const aSecond = await login(a);
  const bCookie = await login(b);
  const bLearner = await identity.getCurrentLearner(
    new Headers({ cookie: bCookie }),
  );
  expect(
    (
      await identity.getCurrentLearner(
        new Headers({ cookie: aFirst, "x-user-id": bLearner!.id }),
      )
    )?.email,
  ).toBe(a);
  expect(
    (await request("revoke-sessions", { userId: bLearner!.id }, aFirst)).status,
  ).toBe(200);
  expect(
    await identity.getCurrentLearner(new Headers({ cookie: aFirst })),
  ).toBeNull();
  expect(
    await identity.getCurrentLearner(new Headers({ cookie: aSecond })),
  ).toBeNull();
  expect((await request("revoke-sessions", {}, aSecond)).status).toBe(401);
  expect(
    (await identity.getCurrentLearner(new Headers({ cookie: bCookie })))?.email,
  ).toBe(b);
});

test("退出测试名单后现有会话也不能继续取得应用身份", async () => {
  const email = await verifiedAccount();
  const cookie = await login(email);
  allowedEmails.delete(email);
  expect(await identity.getCurrentLearner(new Headers({ cookie }))).toBeNull();
  expect((await request("revoke-sessions", {}, cookie)).status).toBe(401);
});

test("邮件投递失败时注册和密码恢复不返回假成功", async () => {
  const failing = createIdentity(
    connection.db,
    config,
    createMailAdapter(false),
  );
  const email = `failed-mail-${crypto.randomUUID()}@example.com`;
  allowedEmails.add(email);
  const signup = await request(
    "sign-up/email",
    { email, password, name: "邮件失败" },
    undefined,
    failing,
  );
  expect(signup.status).toBe(503);
  const registered = await verifiedAccount();
  const reset = await request(
    "request-password-reset",
    { email: registered },
    undefined,
    failing,
  );
  expect(reset.status).toBe(503);
  expect(await reset.json()).toMatchObject({
    message: "身份服务暂时不可用，请稍后重试或联系维护者检查配置。",
  });
});

test("同一实例中一次投递失败不影响并发的其他注册", async () => {
  const failedEmail = `failed-${crypto.randomUUID()}@example.com`;
  const successfulEmail = `success-${crypto.randomUUID()}@example.com`;
  allowedEmails.add(failedEmail);
  allowedEmails.add(successfulEmail);
  const mixed = createIdentity(connection.db, config, {
    async send(message) {
      if (message.to === failedEmail) throw new Error("模拟文件写入失败");
      messages.push(message);
    },
  });
  const results = await Promise.all(
    [failedEmail, successfulEmail].map((email) =>
      request(
        "sign-up/email",
        { email, password, name: "并发投递" },
        undefined,
        mixed,
      ),
    ),
  );
  expect(results.map((result) => result.status)).toEqual([503, 200]);
  expect(
    (
      await request(
        `verify-email?token=${mailToken(successfulEmail, "verification")}`,
        undefined,
        undefined,
        mixed,
      )
    ).status,
  ).toBe(200);
});
