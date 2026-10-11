import { del, get, put } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { MAX_RECORDING_BYTES, type PrivateObjectStore } from "./private";

export function createBlobObjectStore(token: string): PrivateObjectStore {
  return {
    authorize(pathname, mediaType, validUntil) {
      return generateClientTokenFromReadWriteToken({
        token,
        pathname,
        validUntil: validUntil.getTime(),
        allowedContentTypes: [mediaType],
        maximumSizeInBytes: MAX_RECORDING_BYTES,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    },
    async read(pathname) {
      const result = await get(pathname, {
        token,
        access: "private",
        useCache: false,
        abortSignal: AbortSignal.timeout(10000),
      });
      if (!result) return null;
      if (result.statusCode !== 200 || result.blob.size > MAX_RECORDING_BYTES) {
        await result.stream?.cancel();
        throw new Error("录音响应无效或超过大小限制。");
      }
      const reader = result.stream.getReader();
      let size = 0;
      const parts: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_RECORDING_BYTES) {
            await reader.cancel();
            throw new Error("录音超过大小限制。");
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(parts);
    },
    async put(pathname, bytes, contentType) {
      await put(pathname, Buffer.from(bytes), {
        token,
        access: "private",
        contentType,
        allowOverwrite: false,
        addRandomSuffix: false,
        abortSignal: AbortSignal.timeout(10000),
      });
    },
    async remove(pathname) {
      await del(pathname, { token, abortSignal: AbortSignal.timeout(10000) });
    },
  };
}
