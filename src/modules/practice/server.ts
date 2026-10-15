import {
  createRecognitionBudget,
  type RecognitionBudget,
} from "./recognition-budget";
import {
  and,
  desc,
  eq,
  isNull,
  isNotNull,
  gt,
  lte,
  inArray,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import type { Learner } from "../identity/contracts";
import type { LearningContent } from "../learning-content/server";
import {
  PracticeError,
  type Attempt,
  type Feedback,
  type PracticeDetail,
  type PracticeSummary,
  type PracticeDeletion,
} from "./contracts";
import {
  practiceDeletion,
  recognitionCall,
  expressionFeedback,
  attemptRecord,
  practiceRecord,
  confirmedTranscript,
} from "./schema";
import type { ExpressionFeedback } from "../../integrations/expression-feedback/contracts";
import type { RecordingFiles } from "../../integrations/files/contracts";
import {
  deletionMarkerSchema,
  type DeletionMarker,
  type RecoveryJournal,
} from "../../integrations/recovery/contracts";

import type {
  Transcription,
  RecognitionResult,
} from "../../integrations/transcription/contracts";

function isTextAssessment(value: string) {
  return (
    /[\u3400-\u9fff]/.test(value) &&
    !/发音|语调|停顿|掌握|得分|分数|综合分|pronunciation|intonation|pauses?|score|mastered/i.test(
      value,
    )
  );
}

function feedbackItemSchema(confirmedText: string) {
  return z
    .object({
      original: z
        .string()
        .min(1)
        .max(20000)
        .refine((value) => confirmedText.includes(value)),
      explanation: z.string().min(1).max(2000).refine(isTextAssessment),
      improved: z
        .string()
        .min(1)
        .max(20000)
        .regex(/[a-zA-Z]/)
        .refine((value) => !/[\u3400-\u9fff]/.test(value)),
    })
    .strict();
}

export function createPractice(
  db: Database,
  content: LearningContent,
  files?: RecordingFiles,
  transcription?: Transcription,
  clock: { now: () => Date } = { now: () => new Date() },
  feedback?: ExpressionFeedback,
  journal?: RecoveryJournal,
  recognitionPolicy?: RecognitionBudget,
) {
  const recognitionBudget = createRecognitionBudget(
    db,
    recognitionPolicy,
    clock.now,
  );
  async function applyDeletion(input: DeletionMarker, replay = false) {
    const marker = deletionMarkerSchema.parse(input);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(practiceRecord)
        .where(eq(practiceRecord.id, marker.practiceId))
        .for("update");
      // A restore missing the original practice cannot safely reconstruct its request identity.
      if (!row || row.learnerId !== marker.learnerId)
        throw new Error("恢复删除标记与练习不匹配，必须保持隔离。");
      const deletedAt = new Date(
        Math.min(
          new Date(marker.deletedAt).getTime(),
          row.deletedAt?.getTime() ?? Infinity,
        ),
      );
      if (!row.deletedAt || row.deletedAt > deletedAt)
        await tx
          .update(practiceRecord)
          .set({ deletedAt })
          .where(eq(practiceRecord.id, row.id));
      if (deletedAt.getTime() + 30 * 86400000 <= clock.now().getTime()) {
        await tx
          .delete(practiceDeletion)
          .where(eq(practiceDeletion.practiceId, row.id));
      } else if (replay) {
        // A backup's old cleanup receipt cannot certify the current storage state.
        const reset = {
          deletedAt,
          status: "pending" as const,
          leaseToken: null,
          leaseExpiresAt: null,
          failure: null,
        };
        await tx
          .insert(practiceDeletion)
          .values({ practiceId: row.id, ...reset })
          .onConflictDoUpdate({
            target: practiceDeletion.practiceId,
            set: reset,
          });
      } else {
        await tx
          .insert(practiceDeletion)
          .values({ practiceId: row.id, deletedAt })
          .onConflictDoNothing();
      }
      await content.releasePracticeReference(row.contentVersionId, row.id, tx);
      await tx
        .delete(attemptRecord)
        .where(eq(attemptRecord.practiceId, row.id));
    });
  }
  function expired(row: typeof attemptRecord.$inferSelect) {
    return row.acceptedAt.getTime() + 30 * 86400000 <= clock.now().getTime();
  }
  async function attempt(
    row: typeof attemptRecord.$inferSelect,
    reader: Pick<Database, "select"> = db,
  ): Promise<Attempt> {
    // One statement gives confirmations and feedback the same PostgreSQL snapshot.
    // Separate reads can combine an older result set with a newer confirmation version.
    const revisions = await reader
      .select({
        confirmation: confirmedTranscript,
        feedback: expressionFeedback,
      })
      .from(confirmedTranscript)
      .leftJoin(
        expressionFeedback,
        eq(expressionFeedback.confirmationId, confirmedTranscript.id),
      )
      .where(eq(confirmedTranscript.attemptId, row.id))
      .orderBy(confirmedTranscript.revision);
    const confirmations = revisions.map(({ confirmation: item }) => ({
      id: item.id,
      revision: item.revision,
      text: item.text,
      rawTranscriptId: item.rawTranscriptId,
      confirmedAt: item.confirmedAt.toISOString(),
    }));
    const results: Feedback[] = revisions.flatMap(({ feedback: item }) =>
      item
        ? [
            {
              confirmationId: item.confirmationId,
              status: item.status,
              rulesVersion: item.rulesVersion,
              requestId: item.requestId,
              leaseExpiresAt: item.leaseExpiresAt?.toISOString() ?? null,
              failure: item.failure,
              result: item.result,
              provenance: item.provenance,
              generatedAt: item.generatedAt?.toISOString() ?? null,
            },
          ]
        : [],
    );
    return {
      id: row.id,
      submissionId: row.submissionId,
      acceptedAt: row.acceptedAt.toISOString(),
      recordingStatus: expired(row) ? "expired" : "available",
      status: row.identificationStatus,
      failure: row.identificationFailure,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      rawTranscript:
        row.rawTranscriptId && row.rawTranscriptText
          ? { id: row.rawTranscriptId, text: row.rawTranscriptText }
          : null,
      feedback: results,
      confirmations,
      currentValidFeedback:
        results.find(
          (item) =>
            item.confirmationId === confirmations.at(-1)?.id &&
            item.status === "succeeded",
        ) ?? null,
    };
  }

  async function owned(learner: Learner | null, id: string) {
    const owner = requireLearner(learner);
    if (!z.uuid().safeParse(id).success) throw new PracticeError("not-found");
    const [row] = await db
      .select()
      .from(practiceRecord)
      .where(
        and(eq(practiceRecord.id, id), eq(practiceRecord.learnerId, owner.id)),
      );
    if (!row || row.deletedAt) throw new PracticeError("not-found");
    return row;
  }
  function requireLearner(learner: Learner | null): Learner {
    if (!learner) throw new PracticeError("unauthorized");
    return learner;
  }
  async function detail(
    row: typeof practiceRecord.$inferSelect,
  ): Promise<PracticeDetail> {
    const version = await content.readVersion(row.contentVersionId);
    return {
      id: row.id,
      title: version.title,
      createdAt: row.createdAt.toISOString(),
      status: row.endedAt ? "ended" : "in-progress",
      content: version,
      attempts: await Promise.all(
        (
          await db
            .select()
            .from(attemptRecord)
            .where(eq(attemptRecord.practiceId, row.id))
            .orderBy(attemptRecord.acceptedAt, attemptRecord.id)
        ).map((row) => attempt(row)),
      ),
      feedbackMode: feedback?.mode ?? "unavailable",
      transcriptionMode: transcription?.mode ?? "unavailable",
      recordingMode: files?.mode ?? "unavailable",
    };
  }
  async function mutateAttempt<T>(
    learner: Learner | null,
    id: string,
    attemptId: string,
    action: (
      tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
      row: typeof attemptRecord.$inferSelect,
      practice: typeof practiceRecord.$inferSelect,
    ) => Promise<T>,
  ) {
    const owner = requireLearner(learner);
    if (
      !z.uuid().safeParse(id).success ||
      !z.uuid().safeParse(attemptId).success
    )
      throw new PracticeError("not-found");
    return db.transaction(async (tx) => {
      const [practice] = await tx
        .select()
        .from(practiceRecord)
        .where(
          and(
            eq(practiceRecord.id, id),
            eq(practiceRecord.learnerId, owner.id),
          ),
        )
        .for("update");
      if (!practice || practice.deletedAt) throw new PracticeError("not-found");
      if (practice.endedAt) throw new PracticeError("ended");
      const [row] = await tx
        .select()
        .from(attemptRecord)
        .where(
          and(
            eq(attemptRecord.id, attemptId),
            eq(attemptRecord.practiceId, id),
          ),
        );
      if (!row) throw new PracticeError("not-found");
      return action(tx, row, practice);
    });
  }
  function deletionResult(
    row: typeof practiceDeletion.$inferSelect,
  ): PracticeDeletion {
    return {
      id: row.practiceId,
      deletedAt: row.deletedAt.toISOString(),
      status:
        row.deletedAt.getTime() + 30 * 86400000 <= clock.now().getTime()
          ? "receipt-expired"
          : row.status,
      leaseExpiresAt:
        row.deletedAt.getTime() + 30 * 86400000 <= clock.now().getTime()
          ? null
          : (row.leaseExpiresAt?.toISOString() ?? null),
      failure:
        row.deletedAt.getTime() + 30 * 86400000 <= clock.now().getTime()
          ? null
          : row.failure,
    };
  }
  async function readDeletion(
    learner: Learner | null,
    id: string,
  ): Promise<PracticeDeletion> {
    const owner = requireLearner(learner);
    if (!z.uuid().safeParse(id).success) throw new PracticeError("not-found");
    const [row] = await db
      .select({ cleanup: practiceDeletion })
      .from(practiceDeletion)
      .innerJoin(
        practiceRecord,
        eq(practiceRecord.id, practiceDeletion.practiceId),
      )
      .where(
        and(eq(practiceRecord.id, id), eq(practiceRecord.learnerId, owner.id)),
      );
    if (row) return deletionResult(row.cleanup);
    const [tombstone] = await db
      .select()
      .from(practiceRecord)
      .where(
        and(
          eq(practiceRecord.id, id),
          eq(practiceRecord.learnerId, owner.id),
          lte(
            practiceRecord.deletedAt,
            new Date(clock.now().getTime() - 30 * 86400000),
          ),
        ),
      );
    if (!tombstone?.deletedAt) throw new PracticeError("not-found");
    return {
      id,
      deletedAt: tombstone.deletedAt.toISOString(),
      status: "receipt-expired",
      leaseExpiresAt: null,
      failure: null,
    };
  }
  async function retryDeletion(
    learner: Learner | null,
    id: string,
  ): Promise<PracticeDeletion> {
    const owner = requireLearner(learner);
    const receipt = await readDeletion(owner, id);
    if (receipt.status === "receipt-expired") return receipt;
    const token = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(practiceDeletion)
        .where(eq(practiceDeletion.practiceId, id))
        .for("update");
      if (!row) throw new PracticeError("not-found");
      if (
        row.status === "processing" &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt > clock.now()
      )
        return null;
      const token = crypto.randomUUID();
      await tx
        .update(practiceDeletion)
        .set({
          status: "processing",
          leaseToken: token,
          leaseExpiresAt: new Date(clock.now().getTime() + 60_000),
          failure: null,
        })
        .where(eq(practiceDeletion.practiceId, id));
      return token;
    });
    if (!token) return readDeletion(owner, id);
    let failure: string | null = null;
    try {
      if (!files || files.mode === "unavailable")
        throw new Error("Unavailable");
      await files.removePractice({ learnerId: owner.id, practiceId: id });
    } catch {
      failure = "练习记录已删除，但录音清理未完成或结果未知。请重试清理。";
    }
    await db
      .update(practiceDeletion)
      .set({
        status: failure ? "failed" : "succeeded",
        failure,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(practiceDeletion.practiceId, id),
          eq(practiceDeletion.leaseToken, token),
          gt(practiceDeletion.leaseExpiresAt, clock.now()),
        ),
      );
    return readDeletion(owner, id);
  }
  return {
    /** Offline recovery interface; never exposed as a learner HTTP operation. */
    replayDeletion: (marker: DeletionMarker) => applyDeletion(marker, true),
    async recoveryMarkers(): Promise<DeletionMarker[]> {
      const rows = await db
        .select()
        .from(practiceRecord)
        .where(isNotNull(practiceRecord.deletedAt));
      return rows.map((row) => ({
        kind: "deletion",
        learnerId: row.learnerId,
        practiceId: row.id,
        deletedAt: row.deletedAt!.toISOString(),
      }));
    },
    async pruneDeletionReceipts() {
      const receipts = await db
        .select({ id: practiceDeletion.practiceId })
        .from(practiceDeletion)
        .where(
          lte(
            practiceDeletion.deletedAt,
            new Date(clock.now().getTime() - 30 * 86400000),
          ),
        )
        .orderBy(practiceDeletion.deletedAt, practiceDeletion.practiceId)
        .limit(100);
      if (receipts.length)
        await db.delete(practiceDeletion).where(
          inArray(
            practiceDeletion.practiceId,
            receipts.map((row) => row.id),
          ),
        );
    },
    async issueRecordingUpload(
      learner: Learner | null,
      id: string,
      input: { uploadId: string; mediaType: string },
    ) {
      const owner = await owned(learner, id);
      if (owner.endedAt) throw new PracticeError("ended");
      if (
        !z.uuid().safeParse(input.uploadId).success ||
        !/^audio\/(webm|ogg|mp4|wav)(;codecs=[a-zA-Z0-9., -]+)?$/.test(
          input.mediaType,
        )
      )
        throw new PracticeError("recording-invalid");
      if (!files?.issueUpload) throw new PracticeError("recording-unavailable");
      const result = await files.issueUpload({
        ...input,
        learnerId: owner.learnerId,
        practiceId: id,
      });
      const current = await owned(learner, id);
      if (current.endedAt) throw new PracticeError("ended");
      return result;
    },
    async completeRecordingUpload(
      learner: Learner | null,
      id: string,
      reference: string,
    ) {
      const owner = await owned(learner, id);
      if (owner.endedAt) throw new PracticeError("ended");
      if (!files?.completeUpload)
        throw new PracticeError("recording-unavailable");
      const result = await files.completeUpload(
        { learnerId: owner.learnerId, practiceId: id },
        reference,
      );
      const current = await owned(learner, id);
      if (current.endedAt) throw new PracticeError("ended");
      return { reference: result.reference };
    },
    async readRecording(
      learner: Learner | null,
      id: string,
      attemptId: string,
    ) {
      const owner = await owned(learner, id);
      if (!z.uuid().safeParse(attemptId).success)
        throw new PracticeError("not-found");
      const [row] = await db
        .select()
        .from(attemptRecord)
        .where(
          and(
            eq(attemptRecord.id, attemptId),
            eq(attemptRecord.practiceId, id),
          ),
        );
      if (!row) throw new PracticeError("not-found");
      if (expired(row)) throw new PracticeError("recording-expired");
      const recording = await files?.read(row.recordingReference);
      if (
        !recording ||
        recording.learnerId !== owner.learnerId ||
        recording.practiceId !== id ||
        recording.digest !== row.recordingDigest
      )
        throw new PracticeError("recording-missing");
      await owned(learner, id);
      if (expired(row)) throw new PracticeError("recording-expired");
      return recording;
    },
    async finish(learner: Learner | null, id: string): Promise<PracticeDetail> {
      const owner = requireLearner(learner);
      if (!z.uuid().safeParse(id).success) throw new PracticeError("not-found");
      const ended = await db.transaction(async (tx) => {
        // All attempt mutations and processing claims use this same practice lock.
        const [row] = await tx
          .select()
          .from(practiceRecord)
          .where(
            and(
              eq(practiceRecord.id, id),
              eq(practiceRecord.learnerId, owner.id),
            ),
          )
          .for("update");
        if (!row || row.deletedAt) throw new PracticeError("not-found");
        if (row.endedAt) return row;
        const rows = await tx
          .select()
          .from(attemptRecord)
          .where(eq(attemptRecord.practiceId, id));
        const attempts: Attempt[] = [];
        for (const row of rows) attempts.push(await attempt(row, tx));
        // Historical feedback requests also block ending until recovered or settled.
        if (
          attempts.some(
            (item) =>
              item.status === "processing" ||
              item.feedback.some((result) => result.status === "processing"),
          )
        )
          throw new PracticeError("processing");
        if (!attempts.some((item) => item.currentValidFeedback))
          throw new PracticeError("feedback-required");
        const [saved] = await tx
          .update(practiceRecord)
          .set({ endedAt: clock.now() })
          .where(eq(practiceRecord.id, id))
          .returning();
        return saved!;
      });
      return detail(ended);
    },
    readDeletion,
    retryDeletion,
    async listDeletions(learner: Learner | null): Promise<PracticeDeletion[]> {
      const owner = requireLearner(learner);
      const rows = await db
        .select({ cleanup: practiceDeletion })
        .from(practiceDeletion)
        .innerJoin(
          practiceRecord,
          eq(practiceRecord.id, practiceDeletion.practiceId),
        )
        .where(eq(practiceRecord.learnerId, owner.id))
        .orderBy(desc(practiceDeletion.deletedAt));
      return rows.map((row) => deletionResult(row.cleanup));
    },
    async delete(
      learner: Learner | null,
      id: string,
    ): Promise<PracticeDeletion> {
      const owner = requireLearner(learner);
      if (!z.uuid().safeParse(id).success) throw new PracticeError("not-found");
      const [row] = await db
        .select()
        .from(practiceRecord)
        .where(
          and(
            eq(practiceRecord.id, id),
            eq(practiceRecord.learnerId, owner.id),
          ),
        );
      if (!row) throw new PracticeError("not-found");
      const proposed: DeletionMarker = {
        kind: "deletion",
        practiceId: id,
        learnerId: owner.id,
        deletedAt: (row.deletedAt ?? clock.now()).toISOString(),
      };
      // Persist outside the database transaction. A failed journal must not erase the only copy.
      const marker = journal
        ? await journal.recordDeletion(proposed)
        : proposed;
      await applyDeletion(marker);
      const result = await readDeletion(owner, id);
      return result.status === "succeeded" ? result : retryDeletion(owner, id);
    },
    async requestFeedback(
      learner: Learner | null,
      id: string,
      attemptId: string,
      confirmationId: string,
    ): Promise<Attempt> {
      if (!z.uuid().safeParse(confirmationId).success)
        throw new PracticeError("invalid");
      const claim = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row, practice) => {
          const [confirmation] = await tx
            .select()
            .from(confirmedTranscript)
            .where(
              and(
                eq(confirmedTranscript.id, confirmationId),
                eq(confirmedTranscript.attemptId, row.id),
              ),
            );
          if (!confirmation) throw new PracticeError("stale");
          const [existing] = await tx
            .select()
            .from(expressionFeedback)
            .where(eq(expressionFeedback.confirmationId, confirmationId));
          if (existing?.status === "succeeded") return null;
          if (existing?.status === "processing")
            throw new PracticeError("processing");
          if (!feedback || feedback.mode === "unavailable")
            throw new PracticeError("feedback-unavailable");
          const token = crypto.randomUUID();
          const values = {
            attemptId,
            status: "processing" as const,
            rulesVersion: "expression-v1",
            requestId: token,
            leaseToken: token,
            leaseExpiresAt: new Date(clock.now().getTime() + 60_000),
            failure: null,
          };
          await tx
            .insert(expressionFeedback)
            .values({ confirmationId, ...values })
            .onConflictDoUpdate({
              target: expressionFeedback.confirmationId,
              set: values,
            });
          return {
            token,
            context: {
              learnerId: practice.learnerId,
              contentVersionId: practice.contentVersionId,
            },
            text: confirmation.text,
            rulesVersion: values.rulesVersion,
          };
        },
      );
      if (!claim)
        return (await this.read(learner, id)).attempts.find(
          (item) => item.id === attemptId,
        )!;
      let result: unknown;
      try {
        result = !/[a-zA-Z]/.test(claim.text)
          ? { kind: "no-content" }
          : await feedback!.generate({
              text: claim.text,
              context: claim.context,
              confirmationId,
              requestId: claim.token,
              rulesVersion: claim.rulesVersion,
            });
      } catch {
        result = { kind: "unknown" };
      }
      const itemSchema = feedbackItemSchema(claim.text);
      const parsed = z
        .object({
          kind: z.literal("generated"),
          summary: z.string().trim().min(1).max(2000).refine(isTextAssessment),
          issues: z.array(itemSchema).max(2),
          alternatives: z.array(itemSchema).max(2),
          provenance: z
            .object({
              provider: z.string().min(1).max(100),
              model: z.string().min(1).max(100),
            })
            .strict(),
        })
        .strict()
        .safeParse(result);
      const failed = z
        .object({ kind: z.enum(["failed", "unknown", "no-content"]) })
        .strict()
        .safeParse(result);
      const failureStatus = failed.success ? failed.data.kind : "failed";
      const restricted = z
        .object({ kind: z.literal("restricted") })
        .strict()
        .safeParse(result).success;
      const failureMessage = restricted
        ? "本次反馈试用未开放、已达限额或已暂停。请联系维护者核对，不要重复请求。"
        : failureStatus === "unknown"
          ? "反馈结果未知；本地异常不表示远端已取消。可重试同一确认文本。"
          : failureStatus === "no-content"
            ? "确认文本没有可用的英语内容，未生成有效反馈。可核对文本后重新确认，或重试同一确认文本。"
            : "反馈服务失败或返回无效结果，未生成有效反馈。请重试同一确认文本。";
      const saved = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row) => {
          const [current] = await tx
            .select()
            .from(expressionFeedback)
            .where(eq(expressionFeedback.confirmationId, confirmationId));
          if (
            !current ||
            current.leaseToken !== claim.token ||
            !current.leaseExpiresAt ||
            current.leaseExpiresAt <= clock.now()
          )
            throw new PracticeError("stale");
          await tx
            .update(expressionFeedback)
            .set(
              parsed.success
                ? {
                    status: "succeeded",
                    result: {
                      summary: parsed.data.summary,
                      issues: parsed.data.issues,
                      alternatives: parsed.data.alternatives,
                    },
                    provenance: parsed.data.provenance,
                    generatedAt: clock.now(),
                    leaseToken: null,
                    leaseExpiresAt: null,
                  }
                : {
                    status: failureStatus,
                    failure: failureMessage,
                    leaseToken: null,
                    leaseExpiresAt: null,
                  },
            )
            .where(eq(expressionFeedback.confirmationId, confirmationId));
          return row;
        },
      );
      if (parsed.success) await feedback?.acceptResult?.(claim.token);
      return attempt(saved);
    },
    async recoverFeedback(
      learner: Learner | null,
      id: string,
      attemptId: string,
      confirmationId: string,
    ): Promise<Attempt> {
      if (!z.uuid().safeParse(confirmationId).success)
        throw new PracticeError("invalid");
      const saved = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row) => {
          const [confirmation] = await tx
            .select()
            .from(confirmedTranscript)
            .where(
              and(
                eq(confirmedTranscript.id, confirmationId),
                eq(confirmedTranscript.attemptId, row.id),
              ),
            );
          if (!confirmation) throw new PracticeError("stale");
          const [current] = await tx
            .select()
            .from(expressionFeedback)
            .where(eq(expressionFeedback.confirmationId, confirmationId));
          if (current?.status !== "processing") return row;
          if (current.leaseExpiresAt && current.leaseExpiresAt > clock.now())
            throw new PracticeError("processing");
          await tx
            .update(expressionFeedback)
            .set({
              status: "unknown",
              failure:
                "本地处理权已过期，反馈结果未知，不表示远端已取消。可重试同一确认文本。",
              leaseToken: null,
              leaseExpiresAt: null,
            })
            .where(eq(expressionFeedback.confirmationId, confirmationId));
          return row;
        },
      );
      return attempt(saved);
    },
    recognitionBudgetStatus: recognitionBudget.status,
    recognitionReceipts: recognitionBudget.receipts,
    reconcileRecognitionUsage: recognitionBudget.reconcile,
    async recognitionRecoveryStatus() {
      const [row] = await db
        .select({ expired: sql<number>`count(*)::integer` })
        .from(attemptRecord)
        .where(
          and(
            eq(attemptRecord.identificationStatus, "processing"),
            lte(attemptRecord.leaseExpiresAt, clock.now()),
          ),
        );
      return { expired: row!.expired };
    },
    /** Maintenance-only: bounded recovery never dispatches a new external request. */
    async recoverExpiredRecognitions(limit = 50) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new PracticeError("invalid");
      const rows = await db
        .select({
          id: attemptRecord.id,
          practiceId: attemptRecord.practiceId,
          learnerId: practiceRecord.learnerId,
        })
        .from(attemptRecord)
        .innerJoin(
          practiceRecord,
          eq(attemptRecord.practiceId, practiceRecord.id),
        )
        .where(
          and(
            eq(attemptRecord.identificationStatus, "processing"),
            lte(attemptRecord.leaseExpiresAt, clock.now()),
            isNull(practiceRecord.deletedAt),
            isNull(practiceRecord.endedAt),
          ),
        )
        .orderBy(attemptRecord.leaseExpiresAt, attemptRecord.id)
        .limit(limit);
      // Independent receipts survive practice deletion; bound and recover those as well.
      const calls = await db
        .select({ id: recognitionCall.id })
        .from(recognitionCall)
        .where(
          and(
            eq(recognitionCall.status, "reserved"),
            lte(recognitionCall.deadline, clock.now()),
          ),
        )
        .orderBy(recognitionCall.deadline, recognitionCall.id)
        .limit(limit);
      if (calls.length)
        await db
          .update(recognitionCall)
          .set({ status: "unknown" })
          .where(
            and(
              inArray(
                recognitionCall.id,
                calls.map((call) => call.id),
              ),
              eq(recognitionCall.status, "reserved"),
              lte(recognitionCall.deadline, clock.now()),
            ),
          );
      let recovered = 0;
      for (const row of rows) {
        try {
          await this.recoverRecognition(
            { id: row.learnerId, email: "", name: "" },
            row.practiceId,
            row.id,
          );
          recovered++;
        } catch (error) {
          if (
            !(error instanceof PracticeError) ||
            !["not-found", "ended", "processing"].includes(error.code)
          )
            throw error;
        }
      }
      return {
        recovered,
        recoveredCalls: calls.length,
        hasMore: rows.length === limit || calls.length === limit,
      };
    },
    async recognize(
      learner: Learner | null,
      id: string,
      attemptId: string,
      options: { acceptDuplicateCost?: boolean } = {},
    ): Promise<Attempt> {
      const claim = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row) => {
          if (expired(row)) throw new PracticeError("recording-expired");
          if (!transcription || transcription.mode === "unavailable")
            throw new PracticeError("transcription-unavailable");
          if (row.identificationStatus === "processing")
            throw new PracticeError("processing");
          if (row.rawTranscriptId) throw new PracticeError("stale");
          if (
            transcription.mode === "bailian" &&
            row.identificationStatus !== "pending-identification" &&
            !options.acceptDuplicateCost
          )
            throw new PracticeError("recognition-retry-consent");
          const token = crypto.randomUUID();
          const expires = new Date(
            clock.now().getTime() +
              (transcription.mode === "bailian" ? 90_000 : 60_000),
          );
          if (transcription.mode === "bailian")
            await recognitionBudget.reserve(tx, {
              id: token,
              attemptId: row.id,
              fingerprint: row.recordingDigest,
              deadline: expires,
            });
          await tx
            .update(attemptRecord)
            .set({
              identificationStatus: "processing",
              identificationFailure: null,
              leaseToken: token,
              leaseExpiresAt: expires,
            })
            .where(eq(attemptRecord.id, row.id));
          return {
            token,
            reference: row.recordingReference,
            digest: row.recordingDigest,
            owner: learner!.id,
          };
        },
      );
      let result: RecognitionResult;
      let failure: string | null = null;
      let recording;
      try {
        recording = await files?.read(claim.reference);
      } catch {
        recording = null;
      }
      if (
        !recording ||
        recording.learnerId !== claim.owner ||
        recording.practiceId !== id ||
        recording.digest !== claim.digest
      ) {
        result = { kind: "failed", dispatched: false };
        failure =
          "原录音暂不可用，未发起识别。可稍后重试原录音；如仍不可用，请再次作答。";
      } else {
        try {
          // Revalidate after storage I/O; an expired/deleted operation must not start a paid request.
          await mutateAttempt(learner, id, attemptId, async (_tx, row) => {
            if (
              row.leaseToken !== claim.token ||
              !row.leaseExpiresAt ||
              row.leaseExpiresAt <= clock.now()
            )
              throw new PracticeError("stale");
          });
          if (transcription?.mode === "bailian")
            recognitionBudget.assertAvailable();
          result = await transcription!.recognize({
            recording,
            requestId: claim.token,
          });
        } catch (error) {
          if (
            error instanceof PracticeError &&
            error.code === "recognition-budget"
          )
            failure =
              "免费识别预算已到期或不可用，尚未发送录音。请联系维护者核对额度。";
          result =
            error instanceof PracticeError
              ? { kind: "failed", dispatched: false }
              : { kind: "unknown" };
        }
      }
      if (result.reason === "format")
        failure =
          "此录音格式或编码后大小不受识别服务支持，尚未发送。请换浏览器或录制更短的作答。";
      if (result.reason === "quota")
        failure =
          "识别服务拒绝请求，可能是免费额度或权限不足。请联系维护者核对，不会自动重发。";
      const parsed = z
        .discriminatedUnion("kind", [
          z.object({
            kind: z.literal("recognized"),
            text: z.string().max(20_000),
          }),
          z.object({ kind: z.literal("failed") }),
          z.object({ kind: z.literal("unknown") }),
          z.object({ kind: z.literal("no-content") }),
        ])
        .safeParse(result);
      if (transcription?.mode === "bailian")
        await recognitionBudget.settle(
          claim.token,
          parsed.success ? result : { kind: "unknown" },
        );
      result = parsed.success ? parsed.data : { kind: "failed" };
      if (!parsed.success)
        failure = "识别服务返回了无效结果，没有保存转写。可重试原录音。";
      const saved = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row) => {
          if (
            row.leaseToken !== claim.token ||
            !row.leaseExpiresAt ||
            row.leaseExpiresAt <= clock.now()
          )
            throw new PracticeError("stale");
          const text =
            result.kind === "recognized" && typeof result.text === "string"
              ? result.text.trim()
              : "";
          const status =
            result.kind === "recognized"
              ? text
                ? "recognized"
                : "no-content"
              : result.kind;
          const [updated] = await tx
            .update(attemptRecord)
            .set({
              identificationStatus: status,
              identificationFailure:
                status === "failed"
                  ? (failure ?? "识别服务明确失败，可重试原录音。")
                  : status === "unknown"
                    ? "识别结果未知；本地请求异常不表示远端已取消。重试会另占额度，且不保证供应商不重复计费。"
                    : status === "no-content"
                      ? "未识别到可用内容，可重试原录音或再次作答。"
                      : null,
              leaseToken: null,
              leaseExpiresAt: null,
              ...(status === "recognized"
                ? {
                    rawTranscriptId: crypto.randomUUID(),
                    rawTranscriptText: text,
                  }
                : {}),
            })
            .where(eq(attemptRecord.id, row.id))
            .returning();
          return updated!;
        },
      );
      return attempt(saved);
    },
    async recoverRecognition(
      learner: Learner | null,
      id: string,
      attemptId: string,
    ): Promise<Attempt> {
      const saved = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row) => {
          if (row.identificationStatus !== "processing") return row;
          if (row.leaseExpiresAt && row.leaseExpiresAt > clock.now())
            throw new PracticeError("processing");
          if (row.leaseToken)
            await tx
              .update(recognitionCall)
              .set({ status: "unknown" })
              .where(
                and(
                  eq(recognitionCall.id, row.leaseToken),
                  eq(recognitionCall.status, "reserved"),
                ),
              );
          const [updated] = await tx
            .update(attemptRecord)
            .set({
              identificationStatus: "unknown",
              identificationFailure:
                "本地处理权已过期，识别结果未知，不表示远端已取消。重试会另占额度，且不保证供应商不重复计费。",
              leaseToken: null,
              leaseExpiresAt: null,
            })
            .where(eq(attemptRecord.id, row.id))
            .returning();
          return updated!;
        },
      );
      return attempt(saved);
    },
    async confirmTranscript(
      learner: Learner | null,
      id: string,
      attemptId: string,
      input: {
        rawTranscriptId: string;
        expectedConfirmationId: string | null;
        text: string;
      },
    ): Promise<Attempt> {
      if (
        !z
          .object({
            rawTranscriptId: z.uuid(),
            expectedConfirmationId: z.uuid().nullable(),
            text: z.string().trim().min(1).max(20_000),
          })
          .strict()
          .safeParse(input).success
      )
        throw new PracticeError("invalid");
      const saved = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row) => {
          if (
            row.identificationStatus !== "recognized" ||
            row.rawTranscriptId !== input.rawTranscriptId
          )
            throw new PracticeError("stale");
          const [latest] = await tx
            .select()
            .from(confirmedTranscript)
            .where(eq(confirmedTranscript.attemptId, attemptId))
            .orderBy(desc(confirmedTranscript.revision))
            .limit(1);
          if ((latest?.id ?? null) !== input.expectedConfirmationId)
            throw new PracticeError("stale");
          await tx.insert(confirmedTranscript).values({
            attemptId,
            rawTranscriptId: input.rawTranscriptId,
            revision: (latest?.revision ?? 0) + 1,
            text: input.text.trim(),
          });
          return row;
        },
      );
      return attempt(saved);
    },
    async saveRecording(
      learner: Learner | null,
      id: string,
      input: { bytes: Uint8Array; mediaType: string },
    ) {
      const row = await owned(learner, id);
      if (row.endedAt) throw new PracticeError("ended");
      if (!files || files.mode === "unavailable")
        throw new PracticeError("recording-unavailable");
      if (
        !input.bytes.length ||
        input.bytes.length > 12 * 1024 * 1024 ||
        !/^audio\/(webm|ogg|mp4|wav)(;codecs=[a-zA-Z0-9., -]+)?$/.test(
          input.mediaType,
        )
      )
        throw new PracticeError("recording-invalid");
      const recording = await files.save({
        ...input,
        learnerId: row.learnerId,
        practiceId: row.id,
      });
      const current = await owned(learner, id);
      if (current.endedAt) throw new PracticeError("ended");
      return { reference: recording.reference };
    },
    async submit(
      learner: Learner | null,
      id: string,
      submissionId: string,
      reference: string,
    ): Promise<Attempt> {
      const owner = requireLearner(learner);
      if (!z.uuid().safeParse(id).success) throw new PracticeError("not-found");
      if (
        !z.uuid().safeParse(submissionId).success ||
        typeof reference !== "string" ||
        reference.length > 250
      )
        throw new PracticeError("invalid");
      // The practice lock is the shared serialization point for future end/delete operations.
      // File I/O happens outside the transaction; acceptance still rechecks current ownership/state.
      await owned(owner, id);
      // Accepted references are immutable: recovery must not depend on file-service availability.
      const [accepted] = await db
        .select()
        .from(attemptRecord)
        .where(
          and(
            eq(attemptRecord.practiceId, id),
            eq(attemptRecord.submissionId, submissionId),
          ),
        );
      if (accepted) {
        if (accepted.recordingReference !== reference)
          throw new PracticeError("conflict");
        return attempt(accepted);
      }
      const recording = files ? await files.inspect(reference) : null;
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(practiceRecord)
          .where(
            and(
              eq(practiceRecord.id, id),
              eq(practiceRecord.learnerId, owner.id),
            ),
          )
          .for("update");
        if (!row || row.deletedAt) throw new PracticeError("not-found");
        const [existing] = await tx
          .select()
          .from(attemptRecord)
          .where(
            and(
              eq(attemptRecord.practiceId, id),
              eq(attemptRecord.submissionId, submissionId),
            ),
          );
        if (existing) {
          if (
            existing.recordingReference !== reference ||
            (recording && existing.recordingDigest !== recording.digest)
          )
            throw new PracticeError("conflict");
          return attempt(existing, tx);
        }
        if (row.endedAt) throw new PracticeError("ended");
        if (
          !recording ||
          recording.learnerId !== owner.id ||
          recording.practiceId !== id
        )
          throw new PracticeError("recording-invalid");
        const acceptedAt = clock.now();
        await files?.accept?.(reference, acceptedAt, tx);
        const [saved] = await tx
          .insert(attemptRecord)
          .values({
            practiceId: id,
            submissionId,
            recordingReference: reference,
            recordingDigest: recording.digest,
            acceptedAt,
          })
          .returning();
        return attempt(saved!, tx);
      });
    },
    async findSubmission(
      learner: Learner | null,
      id: string,
      submissionId: string,
    ): Promise<Attempt | null> {
      await owned(learner, id);
      if (!z.uuid().safeParse(submissionId).success)
        throw new PracticeError("invalid");
      const [row] = await db
        .select()
        .from(attemptRecord)
        .where(
          and(
            eq(attemptRecord.practiceId, id),
            eq(attemptRecord.submissionId, submissionId),
          ),
        );
      return row ? attempt(row) : null;
    },
    // Learner is supplied only by the trusted identity entry point, never by a request body.
    async start(
      learner: Learner | null,
      materialKey: string,
      requestId: string,
    ): Promise<PracticeDetail> {
      const owner = requireLearner(learner);
      if (
        !z
          .string()
          .regex(/^[a-z0-9-]{1,100}$/)
          .safeParse(materialKey).success
      )
        throw new PracticeError("invalid");
      if (!z.uuid().safeParse(requestId).success)
        throw new PracticeError("invalid");
      const sameRequest = and(
        eq(practiceRecord.learnerId, owner.id),
        eq(practiceRecord.requestId, requestId),
      );
      async function accepted(row: typeof practiceRecord.$inferSelect) {
        if (row.deletedAt) throw new PracticeError("not-found");
        const result = await detail(row);
        if (
          row.repeatOfId !== null ||
          result.content.materialKey !== materialKey
        )
          throw new PracticeError("conflict");
        return result;
      }
      const [existing] = await db
        .select()
        .from(practiceRecord)
        .where(sameRequest);
      if (existing) return accepted(existing);
      const row = await db.transaction(async (tx) => {
        const version = await content.latestAvailable(materialKey, tx);
        await tx
          .insert(practiceRecord)
          .values({
            learnerId: owner.id,
            contentVersionId: version.id,
            requestId,
          })
          .onConflictDoNothing({
            target: [practiceRecord.learnerId, practiceRecord.requestId],
          });
        const [created] = await tx
          .select()
          .from(practiceRecord)
          .where(sameRequest);
        if (!created) throw new Error("练习保存失败，请稍后重试。");
        await content.retainPracticeReference(
          created.contentVersionId,
          created.id,
          tx,
        );
        return created;
      });
      return accepted(row);
    },
    async repeat(
      learner: Learner | null,
      id: string,
      requestId: string,
    ): Promise<PracticeDetail> {
      const owner = requireLearner(learner);
      if (!z.uuid().safeParse(id).success) throw new PracticeError("not-found");
      if (!z.uuid().safeParse(requestId).success)
        throw new PracticeError("invalid");
      const row = await db.transaction(async (tx) => {
        const [original] = await tx
          .select()
          .from(practiceRecord)
          .where(
            and(
              eq(practiceRecord.id, id),
              eq(practiceRecord.learnerId, owner.id),
            ),
          )
          .for("update");
        if (!original || original.deletedAt)
          throw new PracticeError("not-found");
        const sameRequest = and(
          eq(practiceRecord.learnerId, owner.id),
          eq(practiceRecord.requestId, requestId),
        );
        const [existing] = await tx
          .select()
          .from(practiceRecord)
          .where(sameRequest);
        if (existing) {
          if (existing.deletedAt) throw new PracticeError("not-found");
          if (existing.repeatOfId !== id) throw new PracticeError("conflict");
          return existing;
        }
        const version = await content.availableVersion(
          original.contentVersionId,
          tx,
        );
        await tx
          .insert(practiceRecord)
          .values({
            learnerId: owner.id,
            contentVersionId: version.id,
            requestId,
            repeatOfId: id,
          })
          .onConflictDoNothing({
            target: [practiceRecord.learnerId, practiceRecord.requestId],
          });
        const [created] = await tx
          .select()
          .from(practiceRecord)
          .where(sameRequest);
        if (!created || created.repeatOfId !== id)
          throw new PracticeError("conflict");
        if (created.deletedAt) throw new PracticeError("not-found");
        await content.retainPracticeReference(
          created.contentVersionId,
          created.id,
          tx,
        );
        return created;
      });
      return detail(row);
    },
    async read(learner: Learner | null, id: string): Promise<PracticeDetail> {
      const owner = requireLearner(learner);
      if (!z.uuid().safeParse(id).success) throw new PracticeError("not-found");
      const [row] = await db
        .select()
        .from(practiceRecord)
        .where(
          and(
            eq(practiceRecord.id, id),
            eq(practiceRecord.learnerId, owner.id),
          ),
        );
      if (!row || row.deletedAt) throw new PracticeError("not-found");
      return detail(row);
    },
    async list(learner: Learner | null): Promise<PracticeSummary[]> {
      const owner = requireLearner(learner);
      const rows = await db
        .select()
        .from(practiceRecord)
        .where(
          and(
            eq(practiceRecord.learnerId, owner.id),
            isNull(practiceRecord.deletedAt),
          ),
        )
        .orderBy(desc(practiceRecord.createdAt), desc(practiceRecord.id));
      return Promise.all(
        rows.map(async (row) => {
          const item = await detail(row);
          return {
            id: item.id,
            title: item.title,
            createdAt: item.createdAt,
            status: item.status,
          };
        }),
      );
    },
  };
}
export type Practice = ReturnType<typeof createPractice>;
