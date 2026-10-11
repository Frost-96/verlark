import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  inspectMaterialWav,
  reviewContentDigest,
} from "../src/integrations/material-audio/preparation";

// Offline preparation only: no cloud call or inference about listening quality.
const [sourcePath, wavPath, provenancePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !wavPath || !provenancePath || !outputPath)
  throw new Error(
    "用法：tsx scripts/prepare-material-audio.ts 内容.json 音频.wav 制作记录.json 输出审校包.json",
  );
const source = z
  .record(z.string(), z.unknown())
  .parse(JSON.parse(await readFile(sourcePath, "utf8")));
delete source.audioPath;
delete source.privateAudio;
const provenance = z
  .object({
    model: z.string().min(1),
    voice: z.string().min(1),
    parameters: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
  })
  .strict()
  .parse(JSON.parse(await readFile(provenancePath, "utf8")));
const audio = inspectMaterialWav(await readFile(wavPath));
await writeFile(
  outputPath,
  JSON.stringify(
    {
      source,
      audioFile: resolve(wavPath),
      audio: { ...audio, ...provenance },
      review: {
        reviewer: "",
        reviewedAt: "",
        contentDigest: reviewContentDigest(source),
        audioDigest: audio.digest,
        note: "",
      },
    },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  "已生成待审校包。请人工完整试听并核对原文、角色、释义和表达任务，再填写审校人、UTC 时间与实际结论；空白审校记录不能发布。",
);
