import nodemailer from "nodemailer";
import type { SMTPTransportOptions } from "nodemailer/lib/smtp-transport";
import type { SendMailOptions } from "nodemailer/lib/mailer";
import type { MailAdapter } from "./contracts";
import { prepareMail, type MailBoundary } from "./message";

export type QQSettings = MailBoundary & {
  user: string;
  authorizationCode: string;
};

type SMTPClient = {
  sendMail(
    message: SendMailOptions,
  ): Promise<{ accepted: unknown[]; rejected: unknown[]; response: string }>;
  close(): void;
};

// A new non-pooled connection per message; no background queue or automatic retry.
export function createQQMail(
  settings: QQSettings,
  createTransport: (options: SMTPTransportOptions) => SMTPClient = (options) =>
    nodemailer.createTransport(options),
): MailAdapter {
  return {
    async send(message) {
      const content = prepareMail(settings, message);
      const transport = createTransport({
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        auth: { user: settings.user, pass: settings.authorizationCode },
        tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
        dnsTimeout: 10_000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        const result = await transport.sendMail({
          from: settings.from,
          to: message.to,
          envelope: { from: settings.from, to: [message.to] },
          ...content,
        });
        if (
          result.accepted.length !== 1 ||
          String(result.accepted[0]).toLowerCase() !==
            message.to.toLowerCase() ||
          result.rejected.length ||
          !/^250\b/.test(result.response)
        )
          throw new Error("unconfirmed");
      } catch {
        // Never expose SMTP replies, credentials or reset links through errors.
        throw new Error("邮件服务未确认接收，请稍后重新申请。");
      } finally {
        transport.close();
      }
    },
  };
}
