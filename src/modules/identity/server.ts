import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../../db/client";
import type { AppConfig } from "../../server/config";
import type { MailAdapter } from "../../integrations/mail/contracts";
import { authErrorMessage, identityMessages, type Learner } from "./contracts";
import * as schema from "./schema";

export function createIdentity(
  db: Database,
  config: AppConfig,
  mail: MailAdapter,
) {
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
        mail.send({
          to: user.email,
          kind: "password-reset",
          url: `${config.baseURL}/reset-password?token=${encodeURIComponent(token)}`,
        }),
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, token }) => {
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
      },
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
    async handleAuthRequest(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname.replace("/api/auth/", "");
      const methods: Record<string, string> = {
        "sign-up/email": "POST",
        "sign-in/email": "POST",
        "sign-out": "POST",
        "send-verification-email": "POST",
        "verify-email": "GET",
        "request-password-reset": "POST",
        "reset-password": "POST",
        "revoke-sessions": "POST",
      };
      if (!methods[path])
        return Response.json({ message: "该操作未开放。" }, { status: 404 });
      if (request.method !== methods[path])
        return Response.json({ message: "请求方式不正确。" }, { status: 405 });
      try {
        if (
          path === "revoke-sessions" &&
          !(await getCurrentLearner(request.headers))
        )
          return Response.json(
            { message: identityMessages.unauthorized },
            { status: 401 },
          );
        const response = await auth.handler(request);
        if (response.ok || (response.status >= 300 && response.status < 400))
          return response;
        const error = await response.json().catch(() => ({}));
        return Response.json(
          {
            code: error.code,
            message:
              response.status === 429
                ? authErrorMessage("TOO_MANY_REQUESTS")
                : authErrorMessage(error.code),
          },
          { status: response.status, headers: response.headers },
        );
      } catch {
        return Response.json(
          { message: identityMessages.unavailable },
          { status: 503 },
        );
      }
    },
  };
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
