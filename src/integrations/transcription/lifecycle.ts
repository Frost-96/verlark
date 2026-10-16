import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";

const scope = new AsyncLocalStorage<object>();
const endpoint = "/api/v1/services/aigc/multimodal-generation/generation";
type Message = {
  request?: { origin?: string; path?: string };
  response?: { statusCode?: number };
  socket?: { encrypted?: boolean };
};
type Stage =
  | "request-created"
  | "request-headers-sent"
  | "body-sent"
  | "headers"
  | "request-error";

/** Observe the existing fetch (including Next's wrapper); never replace its dispatcher. */
export async function observeTranscription<T>(
  host: string,
  model: string,
  work: () => Promise<T>,
): Promise<T> {
  const token = {};
  const requests = new WeakSet<object>();
  const started = performance.now();
  const timeline: Array<{
    stage: Stage;
    elapsedMs: number;
    tls?: boolean;
    httpStatus?: number;
  }> = [];
  const subscriptions: Array<() => void> = [];
  const note = (
    stage: Stage,
    extra: { tls?: boolean; httpStatus?: number } = {},
  ) => {
    if (timeline.length < 30)
      timeline.push({
        stage,
        elapsedMs: Math.round(performance.now() - started),
        ...extra,
      });
  };
  const subscribe = (name: string, read: (message: Message) => void) => {
    const source = channel(name);
    const listener = (raw: unknown) => {
      try {
        read(raw as Message);
      } catch {
        /* Diagnostics never change the request result. */
      }
    };
    source.subscribe(listener);
    subscriptions.push(() => source.unsubscribe(listener));
  };
  subscribe("undici:request:create", ({ request }) => {
    if (
      scope.getStore() === token &&
      request?.origin === `https://${host}` &&
      request.path === endpoint
    ) {
      requests.add(request);
      note("request-created");
    }
  });
  subscribe("undici:client:sendHeaders", ({ request, socket }) => {
    if (request && requests.has(request))
      note("request-headers-sent", { tls: socket?.encrypted === true });
  });
  for (const [name, stage] of [
    ["bodySent", "body-sent"],
    ["headers", "headers"],
    ["error", "request-error"],
  ] as const)
    subscribe(`undici:request:${name}`, ({ request, response }) => {
      if (!request || !requests.has(request)) return;
      const status = response?.statusCode;
      note(
        stage,
        stage === "headers" &&
          Number.isInteger(status) &&
          status! >= 100 &&
          status! <= 599
          ? { httpStatus: status }
          : {},
      );
    });
  try {
    return await scope.run(token, work);
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
    try {
      console.info({
        event: "transcription-lifecycle",
        model,
        elapsedMs: Math.round(performance.now() - started),
        timeline,
      });
    } catch {
      /* Logging must not change recognition or budget semantics. */
    }
  }
}
