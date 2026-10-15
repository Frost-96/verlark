import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import type { ExpressionFeedback } from "./contracts";
import { feedbackMessages } from "./prompt";
export { feedbackPromptVersion } from "./prompt";
import { feedbackPromptVersion } from "./prompt";

export const feedbackModel = "qwen3.8-max-0902";
export const supportedFeedbackModels = [
  feedbackModel,
  "qwen3.7-flash-2026-07-15",
] as const;
export type FeedbackModel = (typeof supportedFeedbackModels)[number];
const maxCompletionTokens = 3072;
const suggestionSchema = {
  type: "object",
  properties: {
    original: { type: "string", minLength: 1, maxLength: 2000 },
    improved: { type: "string", minLength: 1, maxLength: 2000 },
    explanation: { type: "string", minLength: 1, maxLength: 1000 },
  },
  required: ["original", "improved", "explanation"],
  additionalProperties: false,
};
const responseSchema = {
  anyOf: [
    {
      type: "object",
      properties: { kind: { type: "string", enum: ["no-content"] } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["generated"] },
        summary: { type: "string", minLength: 1, maxLength: 500 },
        issues: { type: "array", maxItems: 2, items: suggestionSchema },
        alternatives: { type: "array", maxItems: 2, items: suggestionSchema },
      },
      required: ["kind", "summary", "issues", "alternatives"],
      additionalProperties: false,
    },
  ],
};
export type FeedbackConfiguration = {
  enabled: boolean;
  model?: FeedbackModel;
  apiKey: string;
  host: string;
  freeTokenBudget: number;
  freeUntil: Date;
  trial?: {
    id: string;
    learnerId: string;
    contentVersionIds: string[];
    startsAt: Date;
  };
};

export function createBailianFeedback(
  db: Database,
  config: FeedbackConfiguration,
  transport: typeof fetch = fetch,
): ExpressionFeedback {
  return {
    mode: "bailian",
    async acceptResult(requestId) {
      if (config.trial)
        await db.execute(
          sql`update feedback_trial_request set accepted=true where request_id=${requestId}::uuid and trial_id=${config.trial.id}`,
        );
    },
    async generate(input) {
      const model = config.model ?? feedbackModel;
      const trial = config.trial;
      if (
        trial &&
        (!trial.id ||
          input.context?.learnerId !== trial.learnerId ||
          trial.contentVersionIds.length !== 6 ||
          new Set(trial.contentVersionIds).size !== 6 ||
          !trial.contentVersionIds.includes(
            input.context?.contentVersionId ?? "",
          ) ||
          !(trial.startsAt <= new Date()) ||
          !(config.freeUntil > new Date()) ||
          !(config.freeUntil.getTime() - trial.startsAt.getTime() > 0) ||
          config.freeUntil.getTime() - trial.startsAt.getTime() >
            2 * 60 * 60 * 1000)
      )
        return { kind: "restricted" };
      if (
        !config.enabled ||
        !config.apiKey ||
        !supportedFeedbackModels.includes(model) ||
        !/^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(config.host) ||
        !Number.isSafeInteger(config.freeTokenBudget) ||
        config.freeTokenBudget <= 0 ||
        !(config.freeUntil > new Date())
      )
        return { kind: "failed" };
      if (!input.text.trim() || !/[a-z]/i.test(input.text))
        return { kind: "no-content" };
      if (input.text.length > 20000 || input.rulesVersion !== "expression-v1")
        return { kind: "failed" };
      const payload = JSON.stringify({
        model,
        messages: feedbackMessages(input.text),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "expression_feedback",
            strict: true,
            schema: responseSchema,
          },
        },
        enable_thinking: true,
        thinking_budget: 1536,
        max_completion_tokens: maxCompletionTokens,
      });
      // UTF-8 bytes bound input tokens conservatively; retain every reservation,
      // including success, rejection and unknown. Never silently recycle free quota.
      const reservation =
        Buffer.byteLength(payload) + maxCompletionTokens + 256;
      const fingerprint = createHash("sha256")
        .update(payload)
        .update(input.confirmationId)
        .digest("hex");
      const accepted = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(20261012, 20)`);
        if (trial) {
          const allowance = await tx.execute(sql`
            select count(*)::int as requests,
              coalesce(sum(greatest(p.reserved_tokens,coalesce(p.observed_tokens,0))),0)::bigint as used,
              coalesce(bool_or(not t.accepted),false) as paused,
              coalesce(bool_or(t.content_version_id=${input.context!.contentVersionId}::uuid),false) as repeated
            from feedback_trial_request t join feedback_provider_request p using(request_id)
            where t.trial_id=${trial.id}`);
          const current = allowance.rows[0]!;
          if (
            Number(current.requests) >= 6 ||
            Number(current.used) + reservation > 100000 ||
            current.paused ||
            current.repeated
          )
            return false;
        }
        const used = await tx.execute(
          sql`select coalesce(sum(greatest(reserved_tokens,coalesce(observed_tokens,0))),0)::bigint as used from feedback_provider_request`,
        );
        if (
          Number(used.rows[0]!.used) + reservation > config.freeTokenBudget ||
          !(config.freeUntil > new Date())
        )
          return false;
        const result = await tx.execute(
          sql`insert into feedback_provider_request(request_id,confirmation_id,fingerprint,model,rules_version,reserved_tokens,deadline) values (${input.requestId}::uuid,${input.confirmationId}::uuid,${fingerprint},${model},${input.rulesVersion + "/" + feedbackPromptVersion},${reservation},now()+interval '45 seconds') on conflict do nothing returning request_id`,
        );
        if (result.rows.length !== 1) return false;
        if (trial)
          await tx.execute(
            sql`insert into feedback_trial_request(request_id,trial_id,content_version_id) values (${input.requestId}::uuid,${trial.id},${input.context!.contentVersionId}::uuid)`,
          );
        return true;
      });
      if (!accepted) return { kind: trial ? "restricted" : "failed" };
      // No SDK retries and no invented provider idempotency guarantee. A repeated
      // request ID cannot send again. Explicit learner retries use a new reservation.
      try {
        const response = await transport(
          `https://${config.host}/compatible-mode/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: payload,
            redirect: "error",
            signal: AbortSignal.timeout(45000),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          return { kind: "unknown" };
        }
        if (!response.body) return { kind: "unknown" };
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 65536) throw new Error("oversize");
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const envelope: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        const body = z
          .object({
            id: z.string().min(1).max(200),
            usage: z.object({ total_tokens: z.number().int().nonnegative() }),
          })
          .parse(envelope);
        await db.execute(
          sql`update feedback_provider_request set provider_id=${body.id}, observed_tokens=${body.usage.total_tokens}, state='responded' where request_id=${input.requestId}::uuid`,
        );
        // Account for a valid receipt before rejecting truncation or malformed
        // content. Thinking is never persisted or exposed as expression feedback.
        const completion = z
          .object({
            choices: z
              .array(
                z.object({
                  finish_reason: z.literal("stop"),
                  message: z.object({ content: z.string() }),
                }),
              )
              .length(1),
          })
          .parse(envelope);
        const result: unknown = JSON.parse(
          completion.choices[0]!.message.content,
        );
        if (
          z
            .object({ kind: z.literal("no-content") })
            .strict()
            .safeParse(result).success
        )
          return { kind: "no-content" };
        if (!result || typeof result !== "object" || Array.isArray(result))
          return { kind: "failed" };
        return {
          ...result,
          provenance: { provider: "bailian-beijing", model },
        };
      } catch {
        return { kind: "unknown" };
      }
    },
  };
}
