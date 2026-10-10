import type { Transcription } from "./contracts";

/** Explicit fixture: no speech recognition or quality claim. No production fallback. */
export function createTranscription(options: {
  development: boolean;
}): Transcription {
  if (!options.development)
    return {
      mode: "unavailable",
      async recognize() {
        throw new Error("识别服务尚未配置。");
      },
    };
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test")
    throw new Error("正式环境或未指定环境禁止开发识别替身。");
  return {
    mode: "development",
    async recognize({ recording }) {
      if (!recording.bytes.length) return { kind: "no-content" };
      return { kind: "recognized", text: "I will reed a book this weekend." };
    },
  };
}
