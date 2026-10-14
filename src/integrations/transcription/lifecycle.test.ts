import { channel } from "node:diagnostics_channel";
import { afterEach, expect, test, vi } from "vitest";
import { createBailianTranscription } from "./bailian";
afterEach(() => vi.restoreAllMocks());
const origin = "https://dashscope.aliyuncs.com";
const path = "/api/v1/services/aigc/multimodal-generation/generation";
const recording = {
  reference: "secret",
  learnerId: "secret",
  practiceId: "secret",
  digest: "secret",
  size: 3,
  mediaType: "audio/webm",
  bytes: new Uint8Array([1, 2, 3]),
};
test("concurrent async fetch wrappers produce isolated safe summaries and unsubscribe", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const events = [
    "undici:request:create",
    "undici:request:bodySent",
    "undici:request:headers",
    "undici:client:sendHeaders",
  ];
  const before = events.map((n) => channel(n).hasSubscribers);
  const adapter = createBailianTranscription({
    apiKey: "secret-key",
    fetch: async () => {
      await Promise.resolve(); // Match a tracing wrapper that awaits before native fetch.
      const request = {
        origin,
        path,
        headers: "secret-header",
        body: "secret-body",
      };
      channel(events[0]!).publish({ request });
      // Even in this async context, a same-host pooled request object is unrelated.
      channel(events[3]!).publish({
        request: { origin, path },
        socket: { encrypted: true },
      });
      await new Promise((r) => setTimeout(r, 1));
      channel(events[3]!).publish({
        request,
        socket: { encrypted: true },
        headers: "secret",
      });
      channel(events[1]!).publish({ request });
      channel(events[2]!).publish({
        request,
        response: { statusCode: 200, headers: "secret-response" },
      });
      return Response.json({ output: { text: "secret-transcript" } });
    },
  });
  const pending = [
    adapter.recognize({ recording, requestId: "a" }),
    adapter.recognize({ recording, requestId: "b" }),
  ];
  // Matching endpoint outside both async contexts must not enter either timeline.
  const unrelated = { origin, path };
  channel(events[0]!).publish({ request: unrelated });
  channel(events[1]!).publish({ request: unrelated });
  channel(events[3]!).publish({
    request: unrelated,
    socket: { encrypted: true },
  });
  expect((await Promise.all(pending)).map((x) => x.kind)).toEqual([
    "recognized",
    "recognized",
  ]);
  expect(log).toHaveBeenCalledTimes(2);
  for (const [entry] of log.mock.calls) {
    expect(entry.event).toBe("transcription-lifecycle");
    expect(entry.timeline.map((v: { stage: string }) => v.stage)).toEqual([
      "request-created",
      "request-headers-sent",
      "body-sent",
      "headers",
    ]);
    expect(Object.keys(entry).sort()).toEqual([
      "elapsedMs",
      "event",
      "model",
      "timeline",
    ]);
    expect(entry.timeline[3].httpStatus).toBe(200);
    expect(JSON.stringify(entry)).not.toMatch(
      /secret|https|aliyuncs|generation/,
    );
  }
  expect(events.map((n) => channel(n).hasSubscribers)).toEqual(before);
});

test("unknown results still summarize and detach; absent lifecycle events do not imply dispatch", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const source = channel("undici:request:create");
  const before = source.hasSubscribers;
  const adapter = createBailianTranscription({
    apiKey: "secret",
    fetch: async () => {
      throw new Error("secret-network-details");
    },
  });
  expect(
    await adapter.recognize({ recording, requestId: "secret" }),
  ).toMatchObject({ kind: "unknown", dispatched: true });
  expect(log).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ event: "transcription-lifecycle", timeline: [] }),
  );
  expect(source.hasSubscribers).toBe(before);
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});
