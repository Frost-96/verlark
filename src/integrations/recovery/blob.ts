import { list, put } from "@vercel/blob";
import { readPrivateBlob } from "../blob-origin";
import { createRecoveryJournal, type JournalObjects } from "./journal";

export function createBlobRecoveryJournal(token: string, namespace: string) {
  const objects: JournalObjects = {
    read: (key) =>
      readPrivateBlob(key, { token, maxBytes: 1024 * 1024, timeoutMs: 10000 }),
    async putIfAbsent(pathname, bytes) {
      await put(pathname, Buffer.from(bytes), {
        token,
        access: "private",
        allowOverwrite: false,
        addRandomSuffix: false,
        contentType: "application/json",
        abortSignal: AbortSignal.timeout(10000),
      });
    },
    async *keys(prefix) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await list({
          token,
          prefix,
          cursor,
          limit: 1000,
          abortSignal: AbortSignal.timeout(10000),
        });
        for (const blob of page.blobs) yield blob.pathname;
        if (!page.hasMore) return;
        if (!page.cursor || cursors.has(page.cursor))
          throw new Error("恢复日志分页未完成。");
        cursor = page.cursor;
        cursors.add(cursor);
      } while (cursor);
    },
  };
  return createRecoveryJournal(objects, namespace);
}
