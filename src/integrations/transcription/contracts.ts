import type { Recording } from "../files/contracts";

/** External recognition only. The practice module owns all durable state. */
export type RecognitionResult =
  | { kind: "recognized"; text: string }
  | { kind: "no-content" }
  | { kind: "failed" }
  | { kind: "unknown" };
export interface Transcription {
  readonly mode: "development" | "unavailable";
  recognize(input: {
    recording: Recording & { bytes: Uint8Array };
    requestId: string;
  }): Promise<RecognitionResult>;
}
