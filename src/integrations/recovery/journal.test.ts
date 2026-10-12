import { expect, test } from "vitest";
import { createRecoveryJournal, type JournalObjects } from "./journal";
import type { DeletionMarker, UploadInventory } from "./contracts";

function fixture() {
  const data = new Map<string, Uint8Array>();
  let loseResponse = false;
  const objects: JournalObjects = {
    async read(key) {
      return data.get(key) ?? null;
    },
    async putIfAbsent(key, bytes) {
      if (data.has(key)) throw new Error("exists");
      data.set(key, bytes.slice());
      if (loseResponse) throw new Error("response lost");
    },
    async *keys(prefix) {
      for (const key of data.keys()) if (key.startsWith(prefix)) yield key;
    },
  };
  return {
    data,
    objects,
    journal: createRecoveryJournal(objects, "test"),
    loseResponse: () => {
      loseResponse = true;
    },
  };
}
function deletion(): DeletionMarker {
  return {
    kind: "deletion",
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
    deletedAt: new Date().toISOString(),
  };
}
function upload(): UploadInventory {
  const id = crypto.randomUUID();
  return {
    kind: "upload",
    id,
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
    temporaryPath: `temporary/${crypto.randomUUID()}/${id}`,
    finalPath: `recordings/${crypto.randomUUID()}/${id}`,
    requestedMediaType: "audio/webm",
    createdAt: new Date().toISOString(),
    permitExpiresAt: new Date().toISOString(),
  };
}
test("缺基线拒绝写入，空列表不能冒充完整恢复日志", async () => {
  const { journal } = fixture();
  await expect(journal.recordDeletion(deletion())).rejects.toThrow(
    "尚未初始化",
  );
  await expect(journal.readAll()).rejects.toThrow("尚未初始化");
});
test("响应丢失后读回同一键，重复删除保持原时间和归属", async () => {
  const f = fixture();
  await f.journal.initialize([]);
  f.loseResponse();
  const entry = deletion();
  expect(await f.journal.recordDeletion(entry)).toEqual(entry);
  expect(
    await f.journal.recordDeletion({
      ...entry,
      deletedAt: new Date(Date.now() + 1000).toISOString(),
    }),
  ).toEqual(entry);
  await expect(
    f.journal.recordDeletion({ ...entry, learnerId: "other" }),
  ).rejects.toThrow("归属冲突");
  expect((await f.journal.readAll()).entries).toEqual([entry]);
});
test("不可覆盖上传路径，缺失基线条目阻断恢复", async () => {
  const f = fixture();
  const entry = upload();
  await f.journal.initialize([entry]);
  await f.journal.recordUpload(entry);
  await expect(
    f.journal.recordUpload({
      ...entry,
      finalPath: `recordings/${crypto.randomUUID()}/${entry.id}`,
    }),
  ).rejects.toThrow("内容冲突");
  f.data.delete(`recovery/test/upload/${entry.id}.json`);
  await expect(f.journal.readAll()).rejects.toThrow("基线不完整");
});
test("日志分页漏读、错误路径和损坏内容不会得到成功回执", async () => {
  const f = fixture();
  const entry = deletion();
  await f.journal.initialize([entry]);
  const bad = createRecoveryJournal(
    {
      ...f.objects,
      async *keys() {
        yield "recovery/test/baseline.json";
      },
    },
    "test",
  );
  await expect(bad.readAll()).rejects.toThrow("基线不完整");
  f.data.set(
    "recovery/test/deletion/wrong.json",
    Buffer.from(JSON.stringify(entry)),
  );
  await expect(f.journal.readAll()).rejects.toThrow("路径与内容不一致");
});
test("写入失败且对象不存在时拒绝确认", async () => {
  const f = fixture();
  await f.journal.initialize([]);
  const bad = createRecoveryJournal(
    {
      ...f.objects,
      async putIfAbsent() {
        throw new Error("offline");
      },
    },
    "test",
  );
  await expect(bad.recordDeletion(deletion())).rejects.toThrow("写入未确认");
});

test("基线响应丢失可以读回核实，错误上传路径不能进入恢复清单", async () => {
  const f = fixture();
  f.loseResponse();
  await f.journal.initialize([]);
  const entry = upload();
  await expect(
    f.journal.recordUpload({
      ...entry,
      finalPath: `recordings/${crypto.randomUUID()}/${crypto.randomUUID()}`,
    }),
  ).rejects.toThrow("路径与标识不一致");
  expect((await f.journal.readAll()).entries).toHaveLength(0);
});
