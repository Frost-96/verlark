import { afterEach, expect, test, vi } from "vitest";
import { createBailianTranscription, ASR_MODEL } from "./bailian";

const recording = {
  reference: "private-secret-reference",
  learnerId: "private-learner",
  practiceId: "private-practice",
  digest: "private-digest",
  size: 3,
  mediaType: "audio/webm",
  bytes: new Uint8Array([1, 2, 3]),
};
afterEach(() => vi.restoreAllMocks());

for (const scenario of [
  "network",
  "timeout",
  "body-read",
  "body-limit",
  "schema",
  "http",
  "empty-body",
] as const) {
  test(`unknown diagnostics distinguish ${scenario} without recording private data`, async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createBailianTranscription({
      apiKey: "private-api-key",
      timeoutMs: 1,
      fetch: async (_url, init) => {
        if (scenario === "network") throw new Error("private-network-error");
        if (scenario === "timeout") {
          await new Promise((resolve) => setTimeout(resolve, 5));
          init!.signal!.throwIfAborted();
        }
        if (scenario === "body-read")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("private-body-error"));
              },
            }),
          );
        if (scenario === "body-limit") return new Response("x".repeat(256001));
        if (scenario === "schema")
          return Response.json({ private: "private-user-text" });
        if (scenario === "http")
          return new Response("private-provider-body", { status: 502 });
        return new Response(null);
      },
    });
    expect(
      await adapter.recognize({ recording, requestId: "private-request" }),
    ).toMatchObject({ kind: "unknown", dispatched: true });
    expect(log).toHaveBeenCalledTimes(1);
    const [entry] = log.mock.calls[0]!;
    expect(entry).toMatchObject({
      event: "transcription-unknown",
      model: ASR_MODEL,
      reason: scenario,
      stage: {
        network: "fetch",
        timeout: "fetch",
        "body-read": "body",
        "body-limit": "body",
        schema: "parse",
        http: "parse",
        "empty-body": "headers",
      }[scenario],
      elapsedMs: expect.any(Number),
    });
    expect(Object.keys(entry).sort()).toEqual(
      (scenario === "network" || scenario === "timeout"
        ? ["event", "model", "reason", "stage", "elapsedMs"]
        : ["event", "model", "reason", "stage", "elapsedMs", "httpStatus"]
      ).sort(),
    );
    if (scenario !== "network" && scenario !== "timeout")
      expect(entry.httpStatus).toBe(scenario === "http" ? 502 : 200);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    expect(JSON.stringify(log.mock.calls)).not.toContain("AQID");
  });
}
