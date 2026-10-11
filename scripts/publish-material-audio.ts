import "./load-env";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { connectDatabase } from "../src/db/client";
import { createLearningContent } from "../src/modules/learning-content/server";
import { createMaterialAudioStore } from "../src/integrations/material-audio/blob";
import {
  inspectMaterialWav,
  reviewContentDigest,
} from "../src/integrations/material-audio/preparation";

const path = process.argv[2];
const databaseURL = process.env.DATABASE_URL;
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (
  !path ||
  !databaseURL ||
  !token ||
  process.env.MATERIAL_AUDIO_PUBLICATION_ENABLED !== "true"
)
  throw new Error(
    "需要审校包路径、DATABASE_URL、BLOB_READ_WRITE_TOKEN，并在核实免费权益与停用控制后显式启用 MATERIAL_AUDIO_PUBLICATION_ENABLED。",
  );
const reviewed = z
  .object({
    source: z.record(z.string(), z.unknown()),
    audioFile: z.string().min(1),
    audio: z
      .object({
        digest: z.string(),
        byteLength: z.number(),
        mediaType: z.literal("audio/wav"),
        durationSeconds: z.number(),
        model: z.string().trim().min(1),
        voice: z.string().trim().min(1),
        parameters: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
      })
      .strict(),
    review: z
      .object({
        reviewer: z.string().trim().min(1),
        reviewedAt: z.iso.datetime(),
        contentDigest: z.string(),
        audioDigest: z.string(),
        note: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict()
  .parse(JSON.parse(await readFile(path, "utf8")));
const bytes = await readFile(reviewed.audioFile);
const inspected = inspectMaterialWav(bytes);
if (
  reviewed.review.contentDigest !== reviewContentDigest(reviewed.source) ||
  reviewed.review.audioDigest !== inspected.digest ||
  reviewed.audio.digest !== inspected.digest ||
  reviewed.audio.byteLength !== inspected.byteLength ||
  reviewed.audio.durationSeconds !== inspected.durationSeconds ||
  new Date(reviewed.review.reviewedAt).getTime() > Date.now()
)
  throw new Error("审校记录与内容或音频不符，请重新审校。");
const files = createMaterialAudioStore(token);
const connection = connectDatabase(databaseURL);
try {
  const receiptPath = `${path}.uploaded.json`;
  let source: Record<string, unknown> & {
    privateAudio: typeof reviewed.audio & {
      reference: string;
      review: typeof reviewed.review;
    };
  };
  try {
    const receipt = z
      .object({
        privateAudio: z
          .object({
            reference: z.string().regex(/^materials\/[a-z0-9-]+\.wav$/),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(JSON.parse(await readFile(receiptPath, "utf8")));
    source = {
      ...reviewed.source,
      privateAudio: {
        ...reviewed.audio,
        reference: receipt.privateAudio.reference,
        review: reviewed.review,
      },
    };
    if (!isDeepStrictEqual(receipt, source))
      throw new Error("审校包已改变，不能复用旧发布记录。");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    const reference = `materials/${inspected.digest}-${randomUUID()}.wav`;
    source = {
      ...reviewed.source,
      privateAudio: { ...reviewed.audio, reference, review: reviewed.review },
    };
    // Durable planned reference precedes cloud I/O, including an unknown upload result.
    await writeFile(receiptPath, JSON.stringify(source, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  }
  const existing = await files.read(source.privateAudio.reference);
  if (existing) {
    if (inspectMaterialWav(existing).digest !== inspected.digest)
      throw new Error("已保存音频与本次审校不符，禁止覆盖。");
  } else await files.putImmutable(bytes, source.privateAudio.reference);
  const published = await createLearningContent(connection.db, {
    files,
    requirePrivateAudio: true,
  }).publish(source);
  console.log(
    `已发布经审校材料：${published.title}（版本 ${published.revision}，标识 ${published.id}）。`,
  );
} catch {
  console.error(
    "材料发布未完成。请保留审校包及 .uploaded.json 记录，核对配置、内容版本和原对象后使用同一审校包重试；不要删除记录或覆盖对象。",
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
