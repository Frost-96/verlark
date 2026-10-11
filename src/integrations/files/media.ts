import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";
import { MAX_RECORDING_BYTES, type ValidateAudio } from "./private";

/** Shared bounded decoder; output is mono 16 kHz signed 16-bit PCM. */
export async function decodeAudio(input: Uint8Array) {
  if (!input.length || input.length > MAX_RECORDING_BYTES || !ffmpeg)
    throw new Error("录音大小无效或解码器未配置。");
  const bytes = Buffer.from(input);
  const binary = ffmpeg;
  const container = bytes
    .subarray(0, 4)
    .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    ? { demuxer: "matroska", mediaType: "audio/webm" }
    : bytes.toString("ascii", 0, 4) === "OggS"
      ? { demuxer: "ogg", mediaType: "audio/ogg" }
      : bytes.toString("ascii", 4, 8) === "ftyp"
        ? { demuxer: "mov", mediaType: "audio/mp4" }
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WAVE"
          ? { demuxer: "wav", mediaType: "audio/wav" }
          : null;
  if (!container) throw new Error("不支持或伪造的音频容器。");
  const directory = await mkdtemp(join(tmpdir(), "verlark-audio-"));
  try {
    const path = join(directory, "input");
    await writeFile(path, bytes, { mode: 0o600 });
    // Decode the whole stream: do not use -t, which would silently accept overlong input.
    // stdout is bounded mono PCM; max_alloc bounds individual allocations, not total RSS.
    const pcm = await new Promise<Buffer>((resolve, reject) => {
      execFile(
        binary,
        [
          "-nostdin",
          "-hide_banner",
          "-v",
          "error",
          "-xerror",
          "-err_detect",
          "explode",
          "-threads",
          "1",
          "-max_alloc",
          "16777216",
          "-protocol_whitelist",
          "file,pipe",
          "-f",
          container.demuxer,
          "-i",
          path,
          "-map",
          "0:a:0",
          "-vn",
          "-sn",
          "-dn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "s16le",
          "pipe:1",
        ],
        {
          encoding: "buffer",
          timeout: 15000,
          killSignal: "SIGKILL",
          maxBuffer: 120 * 32000,
        },
        (error, stdout) => {
          if (error) reject(new Error("录音无法完整解码、过长或解码超时。"));
          else resolve(stdout);
        },
      );
    });
    if (!pcm.length || pcm.length % 2 || pcm.length > 120 * 32000)
      throw new Error("录音为空或超过 120 秒。");
    return {
      mediaType: container.mediaType,
      pcm,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const validateRecordingAudio: ValidateAudio = async (input) => {
  const { mediaType, pcm } = await decodeAudio(input);
  return { mediaType, durationMs: Math.ceil(pcm.length / 32) };
};
