import { prepareMail } from "./message";
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
      const content = prepareMail(settings, message);
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
          ...content,
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
