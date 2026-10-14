import { expect, test } from "vitest";
import { createBailianTranscription } from "./bailian";
const recording = {
  reference: "private",
  learnerId: "a",
  practiceId: "p",
  digest: "sha",
  size: 3,
  mediaType: "audio/webm;codecs=opus",
  bytes: new Uint8Array([1, 2, 3]),
};
test("百炼北京同步协议返回真实英文与用量，不把请求标识冒充幂等键", async () => {
  const adapter = createBailianTranscription({
    apiKey: "test",
    fetch: async (url, options) => {
      const body = JSON.parse(String(options?.body));
      expect(String(url)).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      );
      expect(body).toMatchObject({
        model: "qwen-audio-3.0-asr-flash",
        parameters: { format: "webm", language_hints: ["en"] },
        input: {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: { data: "data:audio/webm;base64,AQID" },
                },
              ],
            },
          ],
        },
      });
      expect(new Headers(options?.headers).has("Idempotency-Key")).toBe(false);
      return Response.json({
        output: { text: "I did not go." },
        usage: { duration: 1.2 },
        request_id: "provider-id",
      });
    },
  });
  expect(await adapter.recognize({ recording, requestId: "local" })).toEqual({
    kind: "recognized",
    text: "I did not go.",
    dispatched: true,
    providerRequestId: "provider-id",
    durationSeconds: 1.2,
  });
});
test("格式与 base64 大小不合规在发出前拒绝；空白、明确拒绝、超时如实呈现", async () => {
  const noSend = createBailianTranscription({
    apiKey: "test",
    fetch: async () => {
      throw new Error("must not send");
    },
  });
  expect(
    await noSend.recognize({
      recording: { ...recording, mediaType: "video/mp4" },
      requestId: "x",
    }),
  ).toMatchObject({ kind: "failed", dispatched: false, reason: "format" });
  expect(
    await noSend.recognize({
      recording: { ...recording, bytes: new Uint8Array(7_500_001) },
      requestId: "x",
    }),
  ).toMatchObject({ kind: "failed", dispatched: false });
  for (const [reply, expected] of [
    [
      Response.json({
        output: { text: " " },
        request_id: "silence",
        usage: { duration: 2 },
      }),
      "no-content",
    ],
    [new Response("denied", { status: 403 }), "failed"],
    [new Response("gateway", { status: 502 }), "unknown"],
    [Response.json({ output: { text: 23 } }), "unknown"],
  ] as const) {
    const adapter = createBailianTranscription({
      apiKey: "test",
      fetch: async () => reply,
    });
    expect(
      await adapter.recognize({ recording, requestId: "x" }),
    ).toMatchObject({ kind: expected, dispatched: true });
  }
  expect(await noSend.recognize({ recording, requestId: "x" })).toMatchObject({
    kind: "unknown",
    dispatched: true,
  });
});
test("北京 workspace 主机与实际嵌套 request_id 协议受支持，其他主机被拒绝", async () => {
  const adapter = createBailianTranscription({
    apiKey: "test",
    host: "ws-example.cn-beijing.maas.aliyuncs.com",
    fetch: async (url) => {
      expect(new URL(String(url)).hostname).toBe(
        "ws-example.cn-beijing.maas.aliyuncs.com",
      );
      return Response.json({
        output: { text: "Actual workspace speech.", request_id: "nested-id" },
        usage: { duration: 2 },
      });
    },
  });
  expect(await adapter.recognize({ recording, requestId: "x" })).toMatchObject({
    kind: "recognized",
    providerRequestId: "nested-id",
  });
  expect(() =>
    createBailianTranscription({ apiKey: "test", host: "attacker.example" }),
  ).toThrow();
});
test("错误回执保留安全请求标识，不泄露原始消息或推断免费", async () => {
  for (const [status, body, id] of [
    [
      400,
      { request_id: "request-top", message: "private audio info" },
      "request-top",
    ],
    [
      403,
      {
        output: { request_id: "request-output" },
        message: "private credential info",
      },
      "request-output",
    ],
    [
      502,
      {
        error: {
          request_id: "request-error",
          message: "private upstream info",
        },
      },
      "request-error",
    ],
  ] as const) {
    const adapter = createBailianTranscription({
      apiKey: "test",
      fetch: async () => Response.json(body, { status }),
    });
    expect(await adapter.recognize({ recording, requestId: "x" })).toEqual({
      kind: status >= 500 ? "unknown" : "failed",
      dispatched: true,
      reason: status === 403 ? "quota" : "provider",
      providerRequestId: id,
    });
  }
});
test("超大或无效错误响应不保存正文或未经验证的请求标识", async () => {
  for (const body of [
    JSON.stringify({ request_id: "bad\nlog", message: "secret" }),
    "x".repeat(256_001),
  ]) {
    const adapter = createBailianTranscription({
      apiKey: "test",
      fetch: async () => new Response(body, { status: 502 }),
    });
    expect(
      await adapter.recognize({ recording, requestId: "x" }),
    ).toMatchObject({ kind: "unknown", dispatched: true });
    expect(
      JSON.stringify(await adapter.recognize({ recording, requestId: "x" })),
    ).not.toContain("secret");
  }
});
