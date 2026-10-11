import { afterEach, expect, test, vi } from "vitest";
import { get } from "@vercel/blob";
import { createBlobObjectStore } from "./blob";
import { createMaterialAudioStore } from "../material-audio/blob";

vi.mock("@vercel/blob", async (original) => ({
  ...(await original<typeof import("@vercel/blob")>()),
  get: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

test("两种私有文件 Adapter 都只把真实缺失当作空值，拒绝错误响应并取消超限数据流", async () => {
  for (const { adapter, reference } of [
    {
      adapter: createBlobObjectStore("test-token"),
      reference: "recordings/test",
    },
    {
      adapter: createMaterialAudioStore("test-token"),
      reference: "materials/test.wav",
    },
  ]) {
    vi.mocked(get).mockResolvedValueOnce(null);
    expect(await adapter.read(reference)).toBeNull();
    vi.mocked(get).mockRejectedValueOnce(
      new Error("provider permission denied"),
    );
    await expect(adapter.read(reference)).rejects.toThrow("permission denied");
    let cancelled = false;
    vi.mocked(get).mockResolvedValueOnce({
      statusCode: 200,
      headers: new Headers(),
      blob: {
        url: "unused",
        downloadUrl: "unused",
        pathname: reference,
        contentDisposition: "inline",
        cacheControl: "private, no-store",
        uploadedAt: new Date(),
        etag: "fixture",
        size: 1,
        contentType: "audio/wav",
      },
      stream: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
    });
    await expect(adapter.read(reference)).rejects.toThrow("超过");
    expect(cancelled).toBe(true);
  }
});
