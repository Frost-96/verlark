import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import type { Learner } from "../identity/contracts";
import type { LearningContent } from "../learning-content/server";
import {
  PracticeError,
  type Attempt,
  type PracticeDetail,
  type PracticeSummary,
} from "./contracts";
import { attemptRecord, practiceRecord, confirmedTranscript } from "./schema";
import type { RecordingFiles } from "../../integrations/files/contracts";

import type {
  Transcription,
  RecognitionResult,
} from "../../integrations/transcription/contracts";

export function createPractice(
  db: Database,
  content: LearningContent,
  files?: RecordingFiles,
  transcription?: Transcription,
  clock: { now: () => Date } = { now: () => new Date() },
) {
  async function attempt(
    row: typeof attemptRecord.$inferSelect,
    reader: Pick<Database, "select"> = db,
  ): Promise<Attempt> {
    return {
      id: row.id,
      submissionId: row.submissionId,
      acceptedAt: row.acceptedAt.toISOString(),
      status: row.identificationStatus,
      failure: row.identificationFailure,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      rawTranscript:
        row.rawTranscriptId && row.rawTranscriptText
          ? { id: row.rawTranscriptId, text: row.rawTranscriptText }
          : null,
      confirmations: (
        await reader
          .select()
          .from(confirmedTranscript)
          .where(eq(confirmedTranscript.attemptId, row.id))
          .orderBy(confirmedTranscript.revision)
      ).map((item) => ({
        id: item.id,
        revision: item.revision,
        text: item.text,
        rawTranscriptId: item.rawTranscriptId,
        confirmedAt: item.confirmedAt.toISOString(),
      })),
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
    if (!row) throw new PracticeError("not-found");
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
      if (!practice) throw new PracticeError("not-found");
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
      return action(tx, row);
    });
  }
  return {
    async recognize(
      learner: Learner | null,
      id: string,
      attemptId: string,
    ): Promise<Attempt> {
      const claim = await mutateAttempt(
        learner,
        id,
        attemptId,
        async (tx, row) => {
          if (!transcription || transcription.mode === "unavailable")
            throw new PracticeError("transcription-unavailable");
          if (row.identificationStatus === "processing")
            throw new PracticeError("processing");
          if (row.rawTranscriptId) throw new PracticeError("stale");
          const token = crypto.randomUUID();
          const expires = new Date(clock.now().getTime() + 60_000);
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
        result = { kind: "failed" };
        failure =
          "原录音暂不可用，未发起识别。可稍后重试原录音；如仍不可用，请再次作答。";
      } else {
        try {
          result = await transcription!.recognize({
            recording,
            requestId: claim.token,
          });
        } catch {
          result = { kind: "unknown" };
        }
      }
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
                    ? "识别结果未知；本地请求异常不表示远端已取消。可重试原录音。"
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
          const [updated] = await tx
            .update(attemptRecord)
            .set({
              identificationStatus: "unknown",
              identificationFailure:
                "本地处理权已过期，识别结果未知，不表示远端已取消。可重试原录音。",
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
        if (!row) throw new PracticeError("not-found");
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
        const [saved] = await tx
          .insert(attemptRecord)
          .values({
            practiceId: id,
            submissionId,
            recordingReference: reference,
            recordingDigest: recording.digest,
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
        const result = await detail(row);
        if (result.content.materialKey !== materialKey)
          throw new PracticeError("conflict");
        return result;
      }
      const [existing] = await db
        .select()
        .from(practiceRecord)
        .where(sameRequest);
      if (existing) return accepted(existing);
      const version = await content.latestAvailable(materialKey);
      await db
        .insert(practiceRecord)
        .values({
          learnerId: owner.id,
          contentVersionId: version.id,
          requestId,
        })
        .onConflictDoNothing({
          target: [practiceRecord.learnerId, practiceRecord.requestId],
        });
      const [row] = await db.select().from(practiceRecord).where(sameRequest);
      if (!row) throw new Error("练习保存失败，请稍后重试。");
      return accepted(row);
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
      if (!row) throw new PracticeError("not-found");
      return detail(row);
    },
    async list(learner: Learner | null): Promise<PracticeSummary[]> {
      const owner = requireLearner(learner);
      const rows = await db
        .select()
        .from(practiceRecord)
        .where(eq(practiceRecord.learnerId, owner.id))
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
