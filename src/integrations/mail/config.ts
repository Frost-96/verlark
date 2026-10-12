import { ConfigurationError } from "../../server/config";
import type { ResendSettings } from "./resend";
export function readMailConfig(
  env: NodeJS.ProcessEnv,
  baseURL: string,
  allowedEmails: Set<string>,
): ResendSettings | undefined {
  if (env.MAIL_ENABLED !== "true") return undefined;
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
    apiKey,
    from,
    baseURL,
    recipients:
      env.MAIL_DOMAIN_VERIFIED === "true" ? allowedEmails : new Set([owner!]),
  };
}
