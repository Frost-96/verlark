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
  readonly mode: "development" | "unavailable";
  save(input: {
    learnerId: string;
    practiceId: string;
    bytes: Uint8Array;
    mediaType: string;
  }): Promise<Recording>;
  inspect(reference: string): Promise<Recording | null>;
}
