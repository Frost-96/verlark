import { isBeijingAsrHost } from "./beijing";
import { z } from "zod";
import type { Transcription, RecognitionResult } from "./contracts";
export const ASR_MODEL = "qwen-audio-3.0-asr-flash";
const requestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const errorReceiptSchema = z.object({
  request_id: requestIdSchema.optional(),
  output: z.object({ request_id: requestIdSchema.optional() }).optional(),
  error: z.object({ request_id: requestIdSchema.optional() }).optional(),
});
const responseSchema = z.object({
  output: z.object({
    text: z.string().max(20_000),
    request_id: requestIdSchema.optional(),
  }),
  request_id: requestIdSchema.optional(),
  usage: z.object({ duration: z.number().finite().nonnegative() }).optional(),
});
/** Single synchronous request. No automatic retry or provider idempotency claim. */
export function createBailianTranscription(options: {
  apiKey: string;
  host?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Transcription {
  const host = options.host ?? "dashscope.aliyuncs.com";
  if (!isBeijingAsrHost(host)) throw new Error("识别只允许百炼北京主机。");
  const send = options.fetch ?? fetch;
  return {
    mode: "bailian",
    async recognize({ recording }): Promise<RecognitionResult> {
      const mime = recording.mediaType.split(";")[0]!.trim().toLowerCase();
      const format = (
        {
          "audio/webm": "webm",
          "audio/mp4": "mp4",
          "audio/ogg": "ogg",
          "audio/wav": "wav",
        } as Record<string, string>
      )[mime];
      // The provider's 10 MB limit applies to base64, not source bytes.
      if (
        !format ||
        !recording.bytes.length ||
        4 * Math.ceil(recording.bytes.length / 3) > 10_000_000
      )
        return { kind: "failed", dispatched: false, reason: "format" };
      const signal = AbortSignal.timeout(options.timeoutMs ?? 45_000);
      const startedAt = performance.now();
      let stage: "fetch" | "headers" | "body" | "parse" = "fetch";
      let httpStatus: number | undefined;
      const diagnoseUnknown = (
        reason:
          | "timeout"
          | "network"
          | "empty-body"
          | "body-read"
          | "body-limit"
          | "schema"
          | "http",
      ) => {
        // Allowlisted metadata only: never log provider data, errors or request details.
        console.warn({
          event: "transcription-unknown",
          model: ASR_MODEL,
          stage,
          reason,
          elapsedMs: Math.round(performance.now() - startedAt),
          ...(httpStatus === undefined ? {} : { httpStatus }),
        });
      };
      try {
        const response = await send(
          `https://${host}/api/v1/services/aigc/multimodal-generation/generation`,
          {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json",
              "X-DashScope-SSE": "disable",
            },
            body: JSON.stringify({
              model: ASR_MODEL,
              input: {
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "input_audio",
                        input_audio: {
                          data: `data:${mime};base64,${Buffer.from(recording.bytes).toString("base64")}`,
                        },
                      },
                    ],
                  },
                ],
              },
              parameters: { format, language_hints: ["en"] },
            }),
          },
        );
        stage = "headers";
        httpStatus = response.status;
        const reader = response.body?.getReader();
        if (!reader) {
          if (response.ok || response.status >= 500)
            diagnoseUnknown("empty-body");
          return {
            kind: response.ok || response.status >= 500 ? "unknown" : "failed",
            dispatched: true,
          };
        }
        stage = "body";
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.length;
            if (size > 256_000) {
              await reader.cancel();
              diagnoseUnknown("body-limit");
              return { kind: "unknown", dispatched: true };
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        stage = "parse";
        let envelope: unknown;
        try {
          envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          envelope = null;
        }
        if (!response.ok) {
          if (response.status >= 500) diagnoseUnknown("http");
          const receipt = errorReceiptSchema.safeParse(envelope);
          return {
            kind: response.status >= 500 ? "unknown" : "failed",
            dispatched: true,
            reason: response.status === 403 ? "quota" : "provider",
            providerRequestId: receipt.success
              ? (receipt.data.request_id ??
                receipt.data.output?.request_id ??
                receipt.data.error?.request_id)
              : undefined,
          };
        }
        const parsed = responseSchema.safeParse(envelope);
        if (!parsed.success) {
          diagnoseUnknown("schema");
          return { kind: "unknown", dispatched: true };
        }
        const { output, usage, request_id } = parsed.data;
        const accounting = {
          dispatched: true,
          providerRequestId: request_id ?? output.request_id,
          durationSeconds: usage?.duration,
        };
        return output.text.trim()
          ? { kind: "recognized", text: output.text.trim(), ...accounting }
          : { kind: "no-content", ...accounting };
      } catch {
        diagnoseUnknown(
          signal.aborted
            ? "timeout"
            : stage === "fetch"
              ? "network"
              : "body-read",
        );
        return { kind: "unknown", dispatched: true };
      }
    },
  };
}
