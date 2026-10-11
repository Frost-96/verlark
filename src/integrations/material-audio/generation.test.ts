import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { prepareBailianMaterial } from "./generation";
import { inspectMaterialWav, reviewContentDigest } from "./preparation";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});
async function directory() {
  const result = await mkdtemp(join(tmpdir(), "material-generation-test-"));
  directories.push(result);
  return result;
}
function providerWav() {
  const bytes = Buffer.alloc(48044);
  bytes.write("RIFF");
  bytes.writeUInt32LE(0x7fffffbf, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(0x7fffff9b, 40);
  return bytes;
}
const source = {
  materialKey: "weekend-plans",
  revision: 2,
  materialText: "A: Hello.\nB: Hi.",
  translation: "你好。",
  task: "向朋友问好",
  audioPath: "/audio/development.wav",
};
const settings = {
  host: "ws-example.cn-beijing.maas.aliyuncs.com",
  apiKey: "test-key",
  generationEnabled: true,
  freeCharacterBudget: 100,
};
test("prepares two verified English voices into an unreviewed bounded WAV bound to exact content, and resumes without paid calls", async () => {
  const outputDirectory = await directory();
  const requests: unknown[] = [];
  const transport: typeof fetch = async (input, init) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        request_id: `r${requests.length}`,
        output: {
          audio: {
            url: `http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/voice${requests.length}.wav`,
          },
        },
        usage: { characters: 6 },
      });
    }
    expect(String(input)).toMatch(
      /^https:\/\/dashscope-result-bj\.oss-cn-beijing\.aliyuncs\.com\//,
    );
    return new Response(providerWav());
  };
  const path = await prepareBailianMaterial(
    { ...settings, source, outputDirectory },
    transport,
  );
  const bundle = JSON.parse(await readFile(path, "utf8"));
  expect(bundle.source).toEqual({
    materialKey: "weekend-plans",
    revision: 2,
    materialText: "A: Hello.\nB: Hi.",
    translation: "你好。",
    task: "向朋友问好",
  });
  expect(bundle.review).toMatchObject({
    reviewer: "",
    reviewedAt: "",
    contentDigest: reviewContentDigest(source),
    note: "",
  });
  expect(inspectMaterialWav(await readFile(bundle.audioFile))).toMatchObject({
    durationSeconds: 2.3,
    digest: bundle.review.audioDigest,
  });
  expect(requests).toEqual([
    {
      model: "qwen-audio-3.0-tts-flash",
      input: {
        text: "Hello.",
        voice: "loongeva_v3.6",
        format: "wav",
        sample_rate: 24000,
        language_hints: ["en"],
        rate: 1,
        volume: 50,
      },
    },
    {
      model: "qwen-audio-3.0-tts-flash",
      input: {
        text: "Hi.",
        voice: "loongjohn",
        format: "wav",
        sample_rate: 24000,
        language_hints: ["en"],
        rate: 1,
        volume: 50,
      },
    },
  ]);
  expect(
    await prepareBailianMaterial(
      { ...settings, source, outputDirectory },
      async () => {
        throw new Error("must not call network on completed run");
      },
    ),
  ).toBe(path);
});

test("keeps an ambiguous request reserved across restarts and refuses a changed content version", async () => {
  const outputDirectory = await directory();
  await expect(
    prepareBailianMaterial(
      { ...settings, source, outputDirectory },
      async () => {
        throw new Error("connection lost");
      },
    ),
  ).rejects.toThrow("connection lost");
  const receipt = JSON.parse(
    await readFile(join(outputDirectory, "turn-1.request.json"), "utf8"),
  );
  expect(receipt).toMatchObject({
    state: "unknown-until-response",
    reservedCharacters: 6,
    request: { input: { text: "Hello." } },
  });
  await expect(
    prepareBailianMaterial(
      { ...settings, source, outputDirectory },
      async () => {
        throw new Error("must not retry");
      },
    ),
  ).rejects.toThrow("禁止自动重发");
  await expect(
    prepareBailianMaterial(
      {
        ...settings,
        source: { ...source, task: "改过的任务" },
        outputDirectory,
      },
      async () => {
        throw new Error("must not retry");
      },
    ),
  ).rejects.toThrow("制作计划已改变");
});

test("resumes only the known successful download after interruption and records each billed response", async () => {
  const outputDirectory = await directory();
  const options = { ...settings, source, outputDirectory };
  await expect(
    prepareBailianMaterial(options, async (_input, init) => {
      if (init?.method === "POST")
        return Response.json({
          request_id: "first-request",
          output: {
            audio: {
              url: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/first.wav",
            },
          },
          usage: { characters: 6 },
        });
      throw new Error("download interrupted");
    }),
  ).rejects.toThrow("download interrupted");
  const path = await prepareBailianMaterial(options, async (_input, init) => {
    if (init?.method === "POST") {
      expect(JSON.parse(String(init.body)).input.text).toBe("Hi.");
      return Response.json({
        request_id: "second-request",
        output: {
          audio: {
            url: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/second.wav",
          },
        },
        usage: { characters: 3 },
      });
    }
    return new Response(providerWav());
  });
  expect(JSON.parse(await readFile(path, "utf8")).review.reviewer).toBe("");
  expect(
    JSON.parse(
      await readFile(join(outputDirectory, "turn-1.response.json"), "utf8"),
    ),
  ).toMatchObject({ requestId: "first-request", characters: 6 });
  expect(
    JSON.parse(
      await readFile(join(outputDirectory, "turn-2.response.json"), "utf8"),
    ),
  ).toMatchObject({ requestId: "second-request", characters: 3 });
});

test("refuses generation without confirmed free budget and does not follow an untrusted download URL", async () => {
  const outputDirectory = await directory();
  const noNetwork: typeof fetch = async () => {
    throw new Error("network forbidden");
  };
  await expect(
    prepareBailianMaterial(
      { ...settings, source, outputDirectory, generationEnabled: false },
      noNetwork,
    ),
  ).rejects.toThrow("免费额度");
  await expect(
    prepareBailianMaterial(
      { ...settings, source, outputDirectory, freeCharacterBudget: 1 },
      noNetwork,
    ),
  ).rejects.toThrow("预算不足");
  await expect(
    prepareBailianMaterial({ ...settings, source, outputDirectory }, async () =>
      Response.json({
        request_id: "request",
        output: { audio: { url: "https://attacker.example/audio.wav" } },
        usage: { characters: 6 },
      }),
    ),
  ).rejects.toThrow("下载地址不受支持");
});
