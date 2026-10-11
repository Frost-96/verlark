import { del, put } from "@vercel/blob";
import { readPrivateBlob } from "../blob-origin";
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
      return readPrivateBlob(pathname, {
        token,
        maxBytes: MAX_RECORDING_BYTES,
        timeoutMs: 10000,
      });
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
