import { z } from "zod";
import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  PracticeError,
  isPracticeError,
} from "../../../modules/practice/contracts";
import { readBoundedJSON } from "./read-json";

type Services = {
  identity: ReturnType<typeof createIdentity>;
  practice: Practice;
};
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
function failure(error: unknown, head = false) {
  const status = isPracticeError(error)
    ? error.code === "unauthorized"
      ? 401
      : error.code === "not-found"
        ? 404
        : error.code === "recording-expired" ||
            error.code === "recording-missing"
          ? 410
          : error.code === "ended" || error.code === "conflict"
            ? 409
            : 400
    : 503;
  return new Response(
    head
      ? null
      : JSON.stringify({
          code: isPracticeError(error) ? error.code : "unavailable",
          message: isPracticeError(error)
            ? error.message
            : "录音暂不可用，请稍后核对上传或回放结果。",
        }),
    {
      status,
      headers: { ...privateHeaders, "Content-Type": "application/json" },
    },
  );
}
export async function handleUploadRequest(
  request: Request,
  services: Services,
  id: string,
) {
  try {
    const learner = await services.identity.getCurrentLearner(request.headers);
    if (!learner) throw new PracticeError("unauthorized");
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: privateHeaders });
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return Response.json(
        { message: "请求来源无效。" },
        { status: 403, headers: privateHeaders },
      );
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("issue"),
            uploadId: z.uuid(),
            mediaType: z.string().max(100),
          })
          .strict(),
        z
          .object({
            action: z.literal("complete"),
            reference: z.string().max(100),
          })
          .strict(),
      ])
      .safeParse(await readBoundedJSON(request, 2048));
    if (!input.success) throw new PracticeError("invalid");
    const result =
      input.data.action === "issue"
        ? await services.practice.issueRecordingUpload(learner, id, input.data)
        : await services.practice.completeRecordingUpload(
            learner,
            id,
            input.data.reference,
          );
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
export async function handleAudioRequest(
  request: Request,
  services: Services,
  id: string,
  attemptId: string,
) {
  const head = request.method === "HEAD";
  try {
    const learner = await services.identity.getCurrentLearner(request.headers);
    if (!learner) throw new PracticeError("unauthorized");
    if (!head && request.method !== "GET")
      return new Response(null, { status: 405, headers: privateHeaders });
    const audio = await services.practice.readRecording(learner, id, attemptId);
    const headers = new Headers({
      ...privateHeaders,
      "Content-Type": audio.mediaType,
      "Content-Length": String(audio.size),
      "Accept-Ranges": "bytes",
    });
    const range = head ? null : request.headers.get("range");
    if (!range)
      return new Response(head ? null : Buffer.from(audio.bytes), { headers });
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
    const maxRange = 1024 * 1024;
    let start = 0,
      end = -1;
    if (parsed && (parsed[1] || parsed[2])) {
      if (!parsed[1]) {
        const suffix = Number(parsed[2]);
        if (Number.isSafeInteger(suffix) && suffix > 0 && suffix <= maxRange) {
          start = Math.max(0, audio.size - suffix);
          end = audio.size - 1;
        }
      } else {
        start = Number(parsed[1]);
        end = parsed[2]
          ? Math.min(Number(parsed[2]), audio.size - 1)
          : Math.min(start + maxRange - 1, audio.size - 1);
      }
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= audio.size ||
      end < start ||
      end - start + 1 > maxRange
    )
      return new Response(null, {
        status: 416,
        headers: {
          ...privateHeaders,
          "Content-Range": `bytes */${audio.size}`,
        },
      });
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${audio.size}`);
    return new Response(Buffer.from(audio.bytes.subarray(start, end + 1)), {
      status: 206,
      headers,
    });
  } catch (error) {
    return failure(error, head);
  }
}
