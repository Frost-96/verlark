import { sql } from "drizzle-orm";
import type { Database } from "../db/client";

/** Protects capture through Blob read-back; deployment isolation is still required
 * after this transaction releases its locks. NOWAIT refuses active writers.
 */
export async function withMediaRecoveryBaselineLock<T>(
  db: Database,
  capture: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Exclusive also excludes a second initializer, while allowing ordinary reads.
    await tx.execute(
      sql`LOCK TABLE practice, recording_asset IN EXCLUSIVE MODE NOWAIT`,
    );
    return capture();
  });
}
