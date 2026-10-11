import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { readPrivateBlob } from "../blob-origin";
import type { MaterialAudioStore } from "./contracts";
import { inspectMaterialWav } from "./preparation";

export function createMaterialAudioStore(token: string): MaterialAudioStore {
  function reference(value: string) {
    if (!/^materials\/[a-z0-9-]+\.wav$/.test(value))
      throw new Error("材料音频引用无效。");
    return value;
  }
  return {
    async putImmutable(bytes, plannedReference) {
      const inspected = inspectMaterialWav(bytes);
      const pathname = reference(
        plannedReference ?? `materials/${inspected.digest}-${randomUUID()}.wav`,
      );
      await put(pathname, Buffer.from(bytes), {
        token,
        access: "private",
        contentType: "audio/wav",
        addRandomSuffix: false,
        allowOverwrite: false,
        multipart: false,
        abortSignal: AbortSignal.timeout(15000),
      });
      return pathname;
    },
    async read(value) {
      return readPrivateBlob(reference(value), {
        token,
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 15000,
      });
    },
    async remove(value) {
      await del(reference(value), {
        token,
        abortSignal: AbortSignal.timeout(15000),
      });
    },
  };
}
