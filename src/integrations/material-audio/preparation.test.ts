import { expect, test } from "vitest";
import { inspectMaterialWav, reviewContentDigest } from "./preparation";

test("material preparation refuses truncated or mislabeled audio before publication", () => {
  expect(() => inspectMaterialWav(Buffer.from("not audio"))).toThrow("音频");
  const bytes = Buffer.alloc(46);
  bytes.write("RIFF");
  bytes.writeUInt32LE(38, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(2, 40);
  expect(inspectMaterialWav(bytes)).toMatchObject({
    byteLength: 46,
    mediaType: "audio/wav",
  });
  expect(() => inspectMaterialWav(bytes.subarray(0, 45))).toThrow("音频");
});

test("review binds the exact editorial content, including task and translation", () => {
  const content = {
    materialText: "A: Hello.",
    translation: "你好",
    task: "问候朋友",
  };
  expect(reviewContentDigest(content)).not.toBe(
    reviewContentDigest({ ...content, task: "告别朋友" }),
  );
  expect(reviewContentDigest(content)).toBe(
    reviewContentDigest({
      task: content.task,
      translation: content.translation,
      materialText: content.materialText,
    }),
  );
});
