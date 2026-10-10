import { expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecordingFiles } from "./server";

test("开发文件引用稳定、跨实例可读，上传失败不冒充文件存在", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verlark-files-"));
  try {
    const adapter = createRecordingFiles({ development: true, directory });
    const input = {
      learnerId: "owner",
      practiceId: crypto.randomUUID(),
      mediaType: "audio/webm",
      bytes: new Uint8Array([1, 2]),
    };
    const saved = await adapter.save(input);
    expect((await adapter.save(input)).reference).toBe(saved.reference);
    expect(
      await createRecordingFiles({ development: true, directory }).inspect(
        saved.reference,
      ),
    ).toEqual(saved);
    expect(await adapter.inspect("../../private-recording")).toBeNull();
    const changed = await adapter.save({
      ...input,
      bytes: new Uint8Array([3, 4]),
    });
    expect(changed.reference).not.toBe(saved.reference);
    expect(await adapter.inspect(saved.reference)).toEqual(saved);
    await rm(directory, { recursive: true });
    expect(await adapter.inspect(saved.reference)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("文件 Adapter 自身也拒绝生产启用，未配置模式不假装保存成功", async () => {
  const disabled = createRecordingFiles({ development: false });
  expect(disabled.mode).toBe("unavailable");
  await expect(
    disabled.save({
      learnerId: "owner",
      practiceId: crypto.randomUUID(),
      mediaType: "audio/webm",
      bytes: new Uint8Array([1]),
    }),
  ).rejects.toThrow("尚未配置");
  vi.stubEnv("NODE_ENV", "production");
  try {
    expect(() => createRecordingFiles({ development: true })).toThrow(
      "正式环境禁止开发录音文件 Adapter",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
