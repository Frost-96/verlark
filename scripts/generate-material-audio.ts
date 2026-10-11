import "./load-env";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { prepareBailianMaterial } from "../src/integrations/material-audio/generation";

const [sourcePath, outputDirectory] = process.argv.slice(2);
if (!sourcePath || !outputDirectory)
  throw new Error(
    "用法：tsx scripts/generate-material-audio.ts 内容.json 私有输出目录",
  );
try {
  const source = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(await readFile(sourcePath, "utf8")));
  const path = await prepareBailianMaterial({
    source,
    outputDirectory,
    host: process.env.DASHSCOPE_API_HOST ?? "",
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    generationEnabled: process.env.MATERIAL_AUDIO_GENERATION_ENABLED === "true",
    freeCharacterBudget: Number(
      process.env.MATERIAL_AUDIO_FREE_CHARACTER_BUDGET ?? "0",
    ),
  });
  console.log(
    `已生成待人工审校包：${path}。请完整试听并核对内容；未发布，未填写人工审校结论。`,
  );
} catch {
  // Provider errors may contain signed URLs or secrets; keep CLI output generic.
  console.error(
    "材料生成未完成。保留全部制作回执；核对免费额度、北京配置与 plan.json。存在 request.json 但缺少 response.json 时，不得自动重发，须先对账。已有 response.json 时可用原命令恢复同一音频下载。详见 docs/material-audio-preparation.md。",
  );
  process.exitCode = 1;
}
