import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import type { MailAdapter } from "./contracts";
/** Reservations survive errors/timeouts: an unknown result may have consumed quota. */
export function limitMail(
  db: Database,
  upstream: MailAdapter,
  scope = "resend",
): MailAdapter {
  return {
    async send(message) {
      const now = new Date();
      const recipient = createHash("sha256")
        .update(message.to.toLowerCase())
        .digest("hex");
      const buckets: [string, number][] = [
        [`${scope}:day:${now.toISOString().slice(0, 10)}`, 90],
        [`${scope}:month:${now.toISOString().slice(0, 7)}`, 2700],
        [
          `${scope}:recipient:${recipient}:${Math.floor(now.getTime() / 60_000)}`,
          1,
        ],
      ];
      // Keep only active recipient-minute buckets. Global day/month counters
      // are tiny and retained for quota accounting.
      await db.execute(
        sql`DELETE FROM mail_send_budget WHERE key LIKE ${scope + ":recipient:%"} AND CAST(substring(key from '[0-9]+$') AS bigint) < ${Math.floor(now.getTime() / 60_000) - 2}`,
      );
      await db.transaction(async (tx) => {
        for (const [key, limit] of buckets) {
          const result = await tx.execute(
            sql`INSERT INTO mail_send_budget (key, used) VALUES (${key},1) ON CONFLICT (key) DO UPDATE SET used=mail_send_budget.used+1 WHERE mail_send_budget.used < ${limit} RETURNING used`,
          );
          if (!result.rows.length)
            throw new Error(
              "发送过于频繁或免费发送额度已达上限，请稍后重试或联系维护者。",
            );
        }
      });
      await upstream.send(message);
    },
  };
}
