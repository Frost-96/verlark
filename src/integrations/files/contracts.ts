/** Stable, private recording identity; never a signed download URL. */
export type Recording = {
  reference: string;
  learnerId: string;
  practiceId: string;
  mediaType: string;
  digest: string;
  size: number;
};
/** Save resolves only after the immutable scoped bytes exist; inspect never trusts client ownership.
 * Missing references return null. Providers must not reassign an existing reference to new content.
 */
export interface RecordingFiles {
  readonly mode: "development" | "unavailable" | "private";
  issueUpload?(input: {
    learnerId: string;
    practiceId: string;
    uploadId: string;
    mediaType: string;
  }): Promise<{ reference: string; pathname: string; clientToken: string }>;
  completeUpload?(
    scope: { learnerId: string; practiceId: string },
    reference: string,
  ): Promise<Recording>;
  accept?(
    reference: string,
    acceptedAt: Date,
    tx: Parameters<
      Parameters<import("../../db/client").Database["transaction"]>[0]
    >[0],
  ): Promise<void>;
  cleanupBatch?(
    limit?: number,
  ): Promise<{ processed: number; pending: number }>;
  maintenanceStatus?(): Promise<{
    lastRunAt: string | null;
    lastCompletedScanAt: string | null;
    due: number;
    pending: number;
    scanOverdue: boolean;
    cleanupOverdue: boolean;
  }>;
  /** Idempotently seal this scope against saves, then remove its recordings.
   * A resolved call means cleanup succeeded; failure may be partial and must be retried.
   */
  removePractice(scope: {
    learnerId: string;
    practiceId: string;
  }): Promise<void>;
  save(input: {
    learnerId: string;
    practiceId: string;
    bytes: Uint8Array;
    mediaType: string;
  }): Promise<Recording>;
  read(reference: string): Promise<(Recording & { bytes: Uint8Array }) | null>;
  inspect(reference: string): Promise<Recording | null>;
}
