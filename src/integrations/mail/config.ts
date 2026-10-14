import { ConfigurationError } from "../../server/config";
import type { QQSettings } from "./qq-smtp";
import type { ResendSettings } from "./resend";
export type MailSettings =
  | ({ provider: "resend" } & ResendSettings)
  | ({ provider: "qq-smtp" } & QQSettings);

export function readMailConfig(
  env: NodeJS.ProcessEnv,
  baseURL: string,
  allowedEmails: Set<string>,
): MailSettings | undefined {
  if (env.MAIL_ENABLED !== "true") return undefined;
  const provider = env.MAIL_PROVIDER ?? "resend";
  if (provider === "qq-smtp") {
    const user = env.QQ_SMTP_USER?.trim().toLowerCase();
    const authorizationCode = env.QQ_SMTP_AUTH_CODE?.trim();
    if (
      env.DEVELOPMENT_MAIL === "true" ||
      !user ||
      !/^[a-z0-9._-]+@qq\.com$/.test(user) ||
      !authorizationCode ||
      /\s/.test(authorizationCode) ||
      env.MAIL_FROM?.trim().toLowerCase() !== user ||
      !allowedEmails.size
    )
      throw new ConfigurationError(
        "QQ SMTP 需要 QQ 发件地址、授权码和收件名单，且不能启用开发替身。",
      );
    return {
      provider,
      user,
      authorizationCode,
      from: user,
      baseURL,
      recipients: allowedEmails,
    };
  }
  if (provider !== "resend") throw new ConfigurationError("未知邮件供应商。");
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  const owner = env.MAIL_TEST_OWNER?.trim().toLowerCase();
  if (
    env.DEVELOPMENT_MAIL === "true" ||
    env.MAIL_FREE_PLAN_CONFIRMED !== "true" ||
    !apiKey ||
    !from ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)
  )
    throw new ConfigurationError(
      "启用邮件需要 Resend 凭据、有效发信地址及免费套餐确认，且不能同时启用开发替身。",
    );
  if (
    env.MAIL_DOMAIN_VERIFIED !== "true" &&
    (!owner || !allowedEmails.has(owner))
  )
    throw new ConfigurationError(
      "未验证发信域名时，仅可向测试名单中的账号本人发送邮件。",
    );
  if (env.MAIL_DOMAIN_VERIFIED === "true" && from.endsWith("@resend.dev"))
    throw new ConfigurationError("测试域名不能作为已验证的正式发信身份。");
  return {
    provider,
    apiKey,
    from,
    baseURL,
    recipients:
      env.MAIL_DOMAIN_VERIFIED === "true" ? allowedEmails : new Set([owner!]),
  };
}
