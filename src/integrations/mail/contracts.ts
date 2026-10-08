export type MailMessage = {
  to: string;
  kind: "verification" | "password-reset";
  url: string;
};
export type MailAdapter = { send(message: MailMessage): Promise<void> };
