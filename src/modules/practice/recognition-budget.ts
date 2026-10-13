import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import type { RecognitionResult } from "../../integrations/transcription/contracts";
import { ASR_MODEL } from "../../integrations/transcription/bailian";
import { recognitionCall } from "./schema";
import { PracticeError } from "./contracts";
export type RecognitionBudget = {
  budgetKey: string;
  allowanceSeconds: number;
  expiresAt: Date;
};
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function createRecognitionBudget(
  db: Database,
  policy: RecognitionBudget | undefined,
  now: () => Date,
) {
  async function used(tx: Pick<Database, "select"> = db) {
    const [row] = await tx
      .select({
        seconds: sql<number>`coalesce(sum(${recognitionCall.reservedSeconds}),0)::integer`,
      })
      .from(recognitionCall)
      .where(eq(recognitionCall.budgetKey, policy!.budgetKey));
    return row!.seconds;
  }
  return {
    async reserve(
      tx: Transaction,
      input: {
        id: string;
        attemptId: string;
        fingerprint: string;
        deadline: Date;
      },
    ) {
      if (
        !policy ||
        !policy.budgetKey ||
        !Number.isSafeInteger(policy.allowanceSeconds) ||
        policy.allowanceSeconds < 120 ||
        !Number.isFinite(policy.expiresAt.getTime()) ||
        policy.expiresAt <= now()
      )
        throw new PracticeError("recognition-budget");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`asr:${policy.budgetKey}`}))`,
      );
      if ((await used(tx)) + 120 > policy.allowanceSeconds)
        throw new PracticeError("recognition-budget");
      await tx.insert(recognitionCall).values({
        ...input,
        budgetKey: policy.budgetKey,
        model: ASR_MODEL,
        reservedSeconds: 120,
        status: "reserved",
        startedAt: now(),
      });
    },
    async settle(id: string, result: RecognitionResult) {
      // Missing/invalid usage, errors and unknowns retain the full worst-case reservation.
      const duration = result.durationSeconds;
      const settled =
        (result.kind === "recognized" || result.kind === "no-content") &&
        typeof duration === "number" &&
        Number.isFinite(duration) &&
        duration >= 0 &&
        duration <= 120;
      await db
        .update(recognitionCall)
        .set({
          status:
            result.dispatched === false
              ? "not-dispatched"
              : settled
                ? "settled"
                : "unknown",
          reservedSeconds:
            result.dispatched === false
              ? 0
              : settled
                ? Math.max(1, Math.ceil(duration))
                : 120,
          providerRequestId: result.providerRequestId?.slice(0, 200) ?? null,
        })
        .where(
          and(
            eq(recognitionCall.id, id),
            eq(recognitionCall.status, "reserved"),
            gt(recognitionCall.deadline, now()),
          ),
        );
      await db
        .update(recognitionCall)
        .set({ status: "unknown" })
        .where(
          and(
            eq(recognitionCall.id, id),
            eq(recognitionCall.status, "reserved"),
            lte(recognitionCall.deadline, now()),
          ),
        );
    },
    async receipts() {
      if (!policy) return [];
      return db
        .select({
          id: recognitionCall.id,
          model: recognitionCall.model,
          status: recognitionCall.status,
          reservedSeconds: recognitionCall.reservedSeconds,
          providerRequestId: recognitionCall.providerRequestId,
          startedAt: recognitionCall.startedAt,
          deadline: recognitionCall.deadline,
          reconciledAt: recognitionCall.reconciledAt,
          reconciliationEvidence: recognitionCall.reconciliationEvidence,
        })
        .from(recognitionCall)
        .where(eq(recognitionCall.budgetKey, policy.budgetKey))
        .orderBy(desc(recognitionCall.startedAt))
        .limit(100);
    },
    async reconcile(id: string, input: { seconds: number; evidence: string }) {
      if (
        !policy ||
        !Number.isSafeInteger(input.seconds) ||
        input.seconds < 0 ||
        input.seconds > 120 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,199}$/.test(input.evidence)
      )
        throw new PracticeError("invalid");
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`asr:${policy.budgetKey}`}))`,
        );
        const [row] = await tx
          .select()
          .from(recognitionCall)
          .where(
            and(
              eq(recognitionCall.id, id),
              eq(recognitionCall.budgetKey, policy.budgetKey),
            ),
          )
          .for("update");
        if (!row) throw new PracticeError("not-found");
        if (row.deadline > now() || row.status === "reserved")
          throw new PracticeError("processing");
        if (
          row.reconciledAt &&
          row.reservedSeconds === input.seconds &&
          row.reconciliationEvidence === input.evidence
        )
          return;
        if (row.status !== "unknown") throw new PracticeError("stale");
        await tx
          .update(recognitionCall)
          .set({
            status: "settled",
            reservedSeconds: input.seconds,
            reconciledAt: now(),
            reconciliationEvidence: input.evidence,
          })
          .where(eq(recognitionCall.id, id));
      });
    },
    async status() {
      if (!policy) return null;
      const committedSeconds = await used();
      return {
        committedSeconds,
        remainingSeconds: Math.max(
          0,
          policy.allowanceSeconds - committedSeconds,
        ),
        expiresAt: policy.expiresAt.toISOString(),
        expired: policy.expiresAt <= now(),
      };
    },
  };
}
