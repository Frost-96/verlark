import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import type { Learner } from "../identity/contracts";
import type { LearningContent } from "../learning-content/server";
import {
  PracticeError,
  type PracticeDetail,
  type PracticeSummary,
} from "./contracts";
import { practiceRecord } from "./schema";

export function createPractice(db: Database, content: LearningContent) {
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
    };
  }
  return {
    // Learner is supplied only by the trusted identity entry point, never by a request body.
    async start(
      learner: Learner | null,
      materialKey: string,
    ): Promise<PracticeDetail> {
      const owner = requireLearner(learner);
      if (
        !z
          .string()
          .regex(/^[a-z0-9-]{1,100}$/)
          .safeParse(materialKey).success
      )
        throw new PracticeError("invalid");
      const version = await content.latestAvailable(materialKey);
      const [row] = await db
        .insert(practiceRecord)
        .values({ learnerId: owner.id, contentVersionId: version.id })
        .returning();
      if (!row) throw new Error("练习保存失败，请稍后重试。");
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
