import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  readdir,
  rm,
  access,
} from "node:fs/promises";
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
      async removePractice() {
        throw new Error("录音存储尚未配置。");
      },
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
  if (process.env.NODE_ENV === "production") {
    throw new Error("正式环境禁止开发录音文件 Adapter。");
  } else {
    // An explicit development branch keeps private runtime files out of production tracing.
    const directory = options.directory ?? ".dev-recordings";
    function scopeKey(scope: { learnerId: string; practiceId: string }) {
      return createHash("sha256")
        .update(JSON.stringify([scope.learnerId, scope.practiceId]))
        .digest("hex");
    }
    function sealPath(scope: { learnerId: string; practiceId: string }) {
      return join(directory, `${scopeKey(scope)}.deleted`);
    }
    async function sealed(scope: { learnerId: string; practiceId: string }) {
      try {
        await access(sealPath(scope));
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return false;
        throw error;
      }
    }
    return {
      mode: "development",
      async removePractice(scope) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        // Persist the fence before sweeping. Every save checks it before and after publication.
        await writeFile(sealPath(scope), "deleted", { mode: 0o600 });
        for (const entry of await readdir(directory)) {
          if (
            entry.startsWith(`${scopeKey(scope)}.`) &&
            entry.endsWith(".tmp")
          ) {
            await rm(join(directory, entry), { force: true });
            continue;
          }
          if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
          try {
            const recording = JSON.parse(
              await readFile(join(directory, entry), "utf8"),
            );
            if (
              recording.learnerId === scope.learnerId &&
              recording.practiceId === scope.practiceId
            )
              await rm(join(directory, entry), { force: true });
          } catch (error) {
            if (!(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            ))
              throw error;
          }
        }
      },
      async save({ bytes, ...scope }) {
        if (await sealed(scope)) throw new Error("练习已删除，不能保存录音。");
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
        const temporary = join(
          directory,
          `${scopeKey(scope)}.${crypto.randomUUID()}.tmp`,
        );
        try {
          await writeFile(
            temporary,
            JSON.stringify({
              ...recording,
              data: Buffer.from(bytes).toString("base64"),
            }),
            { mode: 0o600 },
          );
          await rename(temporary, join(directory, `${key}.json`));
          if (await sealed(scope)) {
            await rm(join(directory, `${key}.json`), { force: true });
            throw new Error("练习已删除，不能保存录音。");
          }
          return recording;
        } finally {
          await rm(temporary, { force: true });
        }
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
        if (!/^development-recording:[a-f0-9]{64}$/.test(reference))
          return null;
        try {
          const { data, ...recording } = JSON.parse(
            await readFile(
              join(directory, `${reference.split(":")[1]}.json`),
              "utf8",
            ),
          );
          const bytes = Buffer.from(data, "base64");
          if (
            (await sealed(recording)) ||
            recording.reference !== reference ||
            bytes.length !== recording.size ||
            createHash("sha256").update(bytes).digest("hex") !==
              recording.digest
          )
            return null;
          return { ...recording, bytes };
        } catch (error) {
          if (
            error instanceof SyntaxError ||
            (error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT")
          )
            return null;
          throw error;
        }
      },
    };
  }
}
