import { expect, test } from "vitest";
import { validateRecordingAudio } from "./media";

function wave(seconds: number) {
  const pcm = Buffer.alloc(16000 * seconds * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
test("真实媒体检查按完整解码时长拒绝伪造、截断、空音频及超过 120 秒的录音", async () => {
  expect(await validateRecordingAudio(wave(1))).toEqual({
    mediaType: "audio/wav",
    durationMs: 1000,
  });
  await expect(
    validateRecordingAudio(new Uint8Array([1, 2, 3])),
  ).rejects.toThrow();
  await expect(validateRecordingAudio(wave(0))).rejects.toThrow();
  await expect(
    validateRecordingAudio(wave(1).subarray(0, 42)),
  ).rejects.toThrow();
  await expect(validateRecordingAudio(wave(121))).rejects.toThrow();
});
