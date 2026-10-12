import { createHash } from "node:crypto";
import type { MailAdapter } from "./contracts";
export type ResendSettings = {
  apiKey: string;
  from: string;
  baseURL: string;
  recipients: Set<string>;
};
export function createResendMail(
  settings: ResendSettings,
  transport: typeof fetch = fetch,
): MailAdapter {
  return {
    async send(message) {
      const link = new URL(message.url);
      if (
        !settings.recipients.has(message.to.toLowerCase()) ||
        link.origin !== settings.baseURL ||
        link.pathname !==
          (message.kind === "verification"
            ? "/verify-email"
            : "/reset-password") ||
        !link.searchParams.get("token")
      )
        throw new Error("邮件收件人或回调地址不符合配置。");
      const response = await transport("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": createHash("sha256")
            .update(
              JSON.stringify([
                "mail-v1",
                settings.from,
                message.to,
                message.kind,
                message.url,
              ]),
            )
            .digest("hex"),
        },
        body: JSON.stringify({
          from: settings.from,
          to: [message.to],
          subject:
            message.kind === "verification"
              ? "验证你的 Verlark 邮箱"
              : "重置你的 Verlark 密码",
          text: `请打开以下链接${message.kind === "verification" ? "验证邮箱（1 小时内有效）" : "重置密码（30 分钟内有效）"}：\n${message.url}\n\n若非本人申请，请忽略。链接仅可使用一次。`,
        }),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        !result ||
        typeof result !== "object" ||
        !("id" in result) ||
        typeof result.id !== "string" ||
        !result.id
      )
        throw new Error("邮件服务未确认接收，请稍后重新申请。");
    },
  };
}
