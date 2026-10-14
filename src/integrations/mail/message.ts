import type { MailMessage } from "./contracts";

export type MailBoundary = {
  from: string;
  baseURL: string;
  recipients: Set<string>;
};

export function prepareMail(settings: MailBoundary, message: MailMessage) {
  const link = new URL(message.url);
  if (
    !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(message.to) ||
    !settings.recipients.has(message.to.toLowerCase()) ||
    link.origin !== settings.baseURL ||
    link.username ||
    link.password ||
    link.pathname !==
      (message.kind === "verification" ? "/verify-email" : "/reset-password") ||
    !link.searchParams.get("token")
  )
    throw new Error("邮件收件人或回调地址不符合配置。");
  return {
    subject:
      message.kind === "verification"
        ? "验证你的 Verlark 邮箱"
        : "重置你的 Verlark 密码",
    text: `请打开以下链接${message.kind === "verification" ? "验证邮箱（1 小时内有效）" : "重置密码（30 分钟内有效）"}：\n${message.url}\n\n若非本人申请，请忽略。链接仅可使用一次。`,
  };
}
