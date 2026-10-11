export type MaterialAudioMetadata = {
  reference: string;
  digest: string;
  byteLength: number;
  mediaType: "audio/wav";
  durationSeconds: number;
  model: string;
  voice: string;
  parameters: Record<string, string | number | boolean>;
  review: {
    reviewer: string;
    reviewedAt: string;
    contentDigest: string;
    audioDigest: string;
    note: string;
  };
};
export interface MaterialAudioStore {
  putImmutable(bytes: Uint8Array, reference?: string): Promise<string>;
  read(reference: string): Promise<Uint8Array | null>;
  remove(reference: string): Promise<void>;
}
