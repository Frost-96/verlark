import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
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
      const result = await get(reference(value), {
        token,
        access: "private",
        useCache: false,
        abortSignal: AbortSignal.timeout(15000),
      });
      if (!result) return null;
      if (result.statusCode !== 200) throw new Error("材料音频读取失败。");
      const reader = result.stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 8 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("材料音频过大。");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    },
    async remove(value) {
      await del(reference(value), {
        token,
        abortSignal: AbortSignal.timeout(15000),
      });
    },
  };
}
