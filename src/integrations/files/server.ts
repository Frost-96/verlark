import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Recording, RecordingFiles } from "./contracts";

/** Local development storage only. This makes no production retention promise. */
export function createRecordingFiles(options: {
  development: boolean;
  directory?: string;
}): RecordingFiles {
  if (!options.development)
    return {
      mode: "unavailable",
      async save() {
        throw new Error("录音存储尚未配置。");
      },
      async read() {
        return null;
      },
      async inspect() {
        return null;
      },
    };
  if (process.env.NODE_ENV === "production")
    throw new Error("正式环境禁止开发录音文件 Adapter。");
  const directory = options.directory ?? ".dev-recordings";
  return {
    mode: "development",
    async save({ bytes, ...scope }) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      const key = createHash("sha256")
        .update(
          JSON.stringify({
            learnerId: scope.learnerId,
            practiceId: scope.practiceId,
            mediaType: scope.mediaType,
            digest,
          }),
        )
        .digest("hex");
      const recording: Recording = {
        ...scope,
        digest,
        size: bytes.length,
        reference: `development-recording:${key}`,
      };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // One atomic document prevents readers from observing half-uploaded metadata/audio.
      const temporary = join(directory, `${crypto.randomUUID()}.tmp`);
      await writeFile(
        temporary,
        JSON.stringify({
          ...recording,
          data: Buffer.from(bytes).toString("base64"),
        }),
        { mode: 0o600 },
      );
      await rename(temporary, join(directory, `${key}.json`));
      return recording;
    },
    async inspect(reference) {
      const found = await this.read(reference);
      if (!found) return null;
      return {
        reference: found.reference,
        learnerId: found.learnerId,
        practiceId: found.practiceId,
        mediaType: found.mediaType,
        digest: found.digest,
        size: found.size,
      };
    },
    async read(reference) {
      if (!/^development-recording:[a-f0-9]{64}$/.test(reference)) return null;
      try {
        const { data, ...recording } = JSON.parse(
          await readFile(
            join(directory, `${reference.split(":")[1]}.json`),
            "utf8",
          ),
        );
        const bytes = Buffer.from(data, "base64");
        if (
          recording.reference !== reference ||
          bytes.length !== recording.size ||
          createHash("sha256").update(bytes).digest("hex") !== recording.digest
        )
          return null;
        return { ...recording, bytes };
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          (error instanceof Error && "code" in error && error.code === "ENOENT")
        )
          return null;
        throw error;
      }
    },
  };
}
