import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { decodeAudio } from "../files/media";
import { inspectMaterialWav, reviewContentDigest } from "./preparation";

const model = "qwen-audio-3.0-tts-flash";
const voices = { A: "loongeva_v3.6", B: "loongjohn" } as const;
const downloadHost = "dashscope-result-bj.oss-cn-beijing.aliyuncs.com";
const maxBytes = 8 * 1024 * 1024;
const gapMs = 300;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// Exclusive, flushed records survive restart. A partial record fails closed; never
// delete a request marker to force a retry after an ambiguous provider result.
async function save(path: string, value: unknown) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
}
async function read(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}
async function saveBytes(path: string, bytes: Uint8Array) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function boundedBody(response: Response, limit: number) {
  if (!response.body) throw new Error("供应商响应为空。");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("供应商响应超过大小限制。");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(parts);
}
function audioURL(raw: string) {
  const url = new URL(raw);
  if (
    url.hostname !== downloadHost ||
    url.username ||
    url.password ||
    url.port ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("供应商音频下载地址不受支持。");
  url.protocol = "https:";
  return url.href;
}
function wave(pcm: Buffer) {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF");
  bytes.writeUInt32LE(pcm.length + 36, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([bytes, pcm]);
}
const successSchema = z.object({
  requestId: z.string().min(1),
  url: z.string(),
  characters: z.number().int().nonnegative(),
});

/** Offline administration seam; never mounted in a learner request or auto-published. */
export async function prepareBailianMaterial(
  options: {
    source: Record<string, unknown>;
    outputDirectory: string;
    host: string;
    apiKey: string;
    generationEnabled: boolean;
    freeCharacterBudget: number;
  },
  transport: typeof fetch = fetch,
) {
  if (
    !options.generationEnabled ||
    !options.apiKey.trim() ||
    !/^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(options.host)
  )
    throw new Error("须核实北京配置、免费额度及用完即停，再显式启用材料生成。");
  const source = Object.fromEntries(
    Object.entries(options.source).filter(
      ([key]) => key !== "audioPath" && key !== "privateAudio",
    ),
  );
  const text = z.string().min(1).parse(source.materialText);
  const turns = text.split(/\r?\n/).map((line) => {
    const match = /^([AB]): (\S.*)$/.exec(line);
    if (!match || !match[2] || match[2].length > 600)
      throw new Error(
        "材料须为 A/B 完整话轮，每轮最多 600 字符（本地试验限制）。",
      );
    const role = match[1] as keyof typeof voices;
    return { role, text: match[2], voice: voices[role] };
  });
  if (
    turns.length < 2 ||
    turns.length > 12 ||
    !turns.some((turn) => turn.role === "A") ||
    !turns.some((turn) => turn.role === "B")
  )
    throw new Error("材料须包含 A/B 两个角色，最多 12 轮。");
  const reservedCharacters = turns.reduce(
    (sum, turn) => sum + [...turn.text].length,
    0,
  );
  if (
    !Number.isSafeInteger(options.freeCharacterBudget) ||
    options.freeCharacterBudget < reservedCharacters
  )
    throw new Error("已核实的本次免费字符预算不足，停止生成。");
  const directory = resolve(options.outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const plan = {
    source,
    contentDigest: reviewContentDigest(source),
    host: options.host,
    model,
    turns,
    format: "wav",
    sampleRate: 24000,
    languageHints: ["en"],
    rate: 1,
    volume: 50,
    outputSampleRate: 16000,
    gapMs,
    reservedCharacters,
  };
  const planPath = join(directory, "plan.json");
  const priorPlan = await read(planPath);
  if (priorPlan === undefined) await save(planPath, plan);
  else if (!isDeepStrictEqual(priorPlan, plan))
    throw new Error("制作计划已改变，请保留原回执并使用独立目录。");
  const chunks: Buffer[] = [];
  const provenance: unknown[] = [];
  for (const [index, turn] of turns.entries()) {
    const base = join(directory, `turn-${index + 1}`);
    let success = await read(`${base}.response.json`);
    if (success === undefined) {
      if ((await read(`${base}.request.json`)) !== undefined)
        throw new Error(
          `话轮 ${index + 1} 已发出请求但未确定成功；禁止自动重发，请先对账。`,
        );
      const request = {
        model,
        input: {
          text: turn.text,
          voice: turn.voice,
          format: "wav",
          sample_rate: 24000,
          language_hints: ["en"],
          rate: 1,
          volume: 50,
        },
      };
      await save(`${base}.request.json`, {
        request,
        startedAt: new Date().toISOString(),
        reservedCharacters: [...turn.text].length,
        state: "unknown-until-response",
      });
      // No retry. Transport/provider errors leave the durable unknown reservation.
      const response = await transport(
        `https://${options.host}/api/v1/services/audio/tts/SpeechSynthesizer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          redirect: "error",
          signal: AbortSignal.timeout(45000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        await save(`${base}.failure.json`, {
          httpStatus: response.status,
          observedAt: new Date().toISOString(),
        });
        throw new Error(
          `话轮 ${index + 1} 供应商请求失败；已保留回执，停止且不重发。`,
        );
      }
      const body = z
        .object({
          request_id: z.string().min(1),
          code: z.string().optional(),
          output: z.object({ audio: z.object({ url: z.string() }) }),
          usage: z.object({ characters: z.number().int().nonnegative() }),
        })
        .parse(
          JSON.parse((await boundedBody(response, 65536)).toString("utf8")),
        );
      if (body.code) throw new Error("供应商未确认成功；请保留回执并对账。");
      success = {
        requestId: body.request_id,
        url: audioURL(body.output.audio.url),
        characters: body.usage.characters,
      };
      await save(`${base}.response.json`, success);
    }
    const result = successSchema.parse(success);
    const rawPath = `${base}.wav`;
    let raw: Buffer;
    try {
      raw = await readFile(rawPath);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      const response = await transport(audioURL(result.url), {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("已合成音频下载失败；仅可重试同一下载，不得重新合成。");
      }
      raw = await boundedBody(response, maxBytes);
      await saveBytes(rawPath, raw);
    }
    const downloaded = {
      digest: digest(raw),
      byteLength: raw.length,
      requestId: result.requestId,
    };
    const priorDownload = await read(`${base}.download.json`);
    if (priorDownload === undefined)
      await save(`${base}.download.json`, downloaded);
    else if (!isDeepStrictEqual(priorDownload, downloaded))
      throw new Error("已下载音频被修改，停止制作。");
    if (
      raw.toString("ascii", 0, 4) !== "RIFF" ||
      raw.toString("ascii", 8, 12) !== "WAVE"
    )
      throw new Error("供应商未返回 WAV。");
    // Bailian's non-streaming download retains a streaming placeholder header.
    // Repair only the observed canonical PCM header, then validate and fully decode.
    const normalized = Buffer.from(raw);
    if (
      raw.length >= 44 &&
      raw.readUInt32LE(4) === 0x7fffffbf &&
      raw.readUInt32LE(40) === 0x7fffff9b &&
      raw.toString("ascii", 12, 16) === "fmt " &&
      raw.readUInt32LE(16) === 16 &&
      raw.toString("ascii", 36, 40) === "data"
    ) {
      normalized.writeUInt32LE(raw.length - 8, 4);
      normalized.writeUInt32LE(raw.length - 44, 40);
    }
    inspectMaterialWav(normalized);
    const { pcm } = await decodeAudio(normalized);
    if (index) chunks.push(Buffer.alloc(gapMs * 32));
    chunks.push(pcm);
    if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) > 120 * 32000)
      throw new Error("材料总时长超过 120 秒。");
    provenance.push({
      role: turn.role,
      text: turn.text,
      voice: turn.voice,
      characters: result.characters,
      ...downloaded,
    });
  }
  const bytes = wave(Buffer.concat(chunks));
  const inspected = inspectMaterialWav(bytes);
  const audioFile = join(directory, "material.wav");
  try {
    if (digest(await readFile(audioFile)) !== inspected.digest)
      throw new Error("已生成音频发生变化。");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    await saveBytes(audioFile, bytes);
  }
  const audio = {
    ...inspected,
    model,
    voice: "A=loongeva_v3.6;B=loongjohn",
    parameters: {
      provider: "bailian-beijing",
      host: options.host,
      sourceSampleRate: 24000,
      sampleRate: 16000,
      language: "en",
      rate: 1,
      volume: 50,
      gapMs,
      generationDigest: reviewContentDigest({ plan, provenance }),
    },
  };
  const bundle = {
    source,
    audioFile,
    audio,
    review: {
      reviewer: "",
      reviewedAt: "",
      contentDigest: reviewContentDigest(source),
      audioDigest: inspected.digest,
      note: "",
    },
  };
  const path = join(directory, "review.json");
  const prior = await read(path);
  if (prior === undefined) await save(path, bundle);
  else {
    const previous = z
      .object({
        source: z.unknown(),
        audioFile: z.string(),
        audio: z.unknown(),
      })
      .parse(prior);
    if (!isDeepStrictEqual(previous, { source, audioFile, audio }))
      throw new Error("审校包的内容或音频已改变。");
  }
  return path;
}
