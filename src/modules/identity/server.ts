import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../../db/client";
import type { AppConfig } from "../../server/config";
import type { MailAdapter } from "../../integrations/mail/contracts";
import type { Learner } from "./contracts";
import * as schema from "./schema";

export function createIdentity(
  db: Database,
  config: Omit<AppConfig, "developmentRecordings" | "developmentTranscription">,
  mail: MailAdapter,
) {
  // Better Auth swallows callback errors. Keep delivery outcome request-local,
  // then reject the public call after Better Auth has awaited its callbacks.
  const delivery = new AsyncLocalStorage<{ failed: boolean }>();
  async function deliver(operation: () => Promise<void>) {
    try {
      await operation();
    } catch {
      const request = delivery.getStore();
      if (request) request.failed = true;
      throw new Error("邮件未能发送，请重试。");
    }
  }
  const auth = betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) =>
        deliver(() =>
          mail.send({
            to: user.email,
            kind: "password-reset",
            url: `${config.baseURL}/reset-password?token=${encodeURIComponent(token)}`,
          }),
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, token }) =>
        deliver(async () => {
          await db
            .insert(schema.emailVerificationReceipt)
            .values({
              digest: tokenDigest(token),
              expiresAt: new Date(Date.now() + 3600_000),
            })
            .onConflictDoNothing();
          await mail.send({
            to: user.email,
            kind: "verification",
            url: `${config.baseURL}/verify-email?token=${encodeURIComponent(token)}`,
          });
        }),
    },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 604800,
      updateAge: 86400,
    },
    verification: { storeIdentifier: "hashed" },
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === "/verify-email") {
          const token: unknown = context.query?.token;
          if (typeof token !== "string")
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_TOKEN",
              message: "验证链接无效。",
            });
          const claimed = await db
            .update(schema.emailVerificationReceipt)
            .set({ consumedAt: new Date() })
            .where(
              and(
                eq(schema.emailVerificationReceipt.digest, tokenDigest(token)),
                isNull(schema.emailVerificationReceipt.consumedAt),
                gt(schema.emailVerificationReceipt.expiresAt, new Date()),
              ),
            )
            .returning({ digest: schema.emailVerificationReceipt.digest });
          if (!claimed.length)
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_TOKEN",
              message: "链接无效、已过期或已使用。",
            });
        }
        if (context.path === "/sign-up/email") {
          const email: unknown = context.body?.email;
          if (
            typeof email !== "string" ||
            !config.allowedEmails.has(email.trim().toLowerCase())
          )
            throw new APIError("FORBIDDEN", {
              code: "NOT_INVITED",
              message: "该邮箱不在测试名单中。",
            });
        }
      }),
    },
  });
  async function getCurrentLearner(headers: Headers): Promise<Learner | null> {
    const session = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    if (
      !session?.user.emailVerified ||
      !config.allowedEmails.has(session.user.email.toLowerCase())
    )
      return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  }
  return {
    getCurrentLearner,
    // Opaque Better Auth protocol adapter; HTTP policy belongs to app/api/auth.
    async handleAuthRequest(request: Request): Promise<Response> {
      return delivery.run({ failed: false }, async () => {
        const response = await auth.handler(request);
        if (delivery.getStore()?.failed)
          throw new Error("邮件未能发送，请重新申请。");
        return response;
      });
    },
  };
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
