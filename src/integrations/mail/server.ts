import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { MailAdapter } from "./contracts";

/** A local outbox, never a delivery provider. No public HTTP mailbox. */
export function createMailAdapter(developmentMail: boolean): MailAdapter {
  if (!developmentMail)
    return {
      async send() {
        throw new Error("真实邮件服务尚未配置，未发送邮件。");
      },
    };
  if (process.env.NODE_ENV === "production")
    throw new Error("正式环境禁止开发邮件替身。");
  return {
    async send(message) {
      await mkdir(".dev-mail", { recursive: true, mode: 0o700 });
      await writeFile(
        `.dev-mail/${Date.now()}-${randomUUID()}.json`,
        JSON.stringify({ ...message, developmentOnly: true }, null, 2),
        { mode: 0o600 },
      );
    },
  };
}
