import { get } from "@vercel/blob";

/** A private, uncached, bounded origin read. No URL or storage credentials reach callers. */
export async function readPrivateBlob(
  pathname: string,
  options: { token: string; maxBytes: number; timeoutMs: number },
): Promise<Uint8Array | null> {
  const result = await get(pathname, {
    token: options.token,
    access: "private",
    useCache: false,
    abortSignal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!result) return null;
  if (result.statusCode !== 200 || result.blob.size > options.maxBytes) {
    await result.stream?.cancel();
    throw new Error("私有音频响应无效或超过大小限制。");
  }
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > options.maxBytes) {
        await reader.cancel();
        throw new Error("私有音频超过大小限制。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
