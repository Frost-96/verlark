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
import { attemptRecord, practiceRecord } from "./schema";
import type { RecordingFiles } from "../../integrations/files/contracts";

export function createPractice(
  db: Database,
  content: LearningContent,
  files?: RecordingFiles,
) {
  function attempt(row: typeof attemptRecord.$inferSelect): Attempt {
    return {
      id: row.id,
      submissionId: row.submissionId,
      acceptedAt: row.acceptedAt.toISOString(),
      status: "pending-identification",
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
      attempts: (
        await db
          .select()
          .from(attemptRecord)
          .where(eq(attemptRecord.practiceId, row.id))
          .orderBy(attemptRecord.acceptedAt, attemptRecord.id)
      ).map(attempt),
      recordingMode: files?.mode ?? "unavailable",
    };
  }
  return {
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
          return attempt(existing);
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
        return attempt(saved!);
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
