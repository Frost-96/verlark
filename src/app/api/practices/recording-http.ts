import { z } from "zod";
import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  isPracticeError,
  PracticeError,
} from "../../../modules/practice/contracts";

type Services = {
  identity: ReturnType<typeof createIdentity>;
  practice: Practice;
};
function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
// Bound the actual streamed body, including requests without Content-Length.
async function bytes(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new PracticeError("recording-invalid");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new PracticeError("recording-invalid");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}
export async function handleRecordingRequest(
  request: Request,
  services: Services,
  id: string,
  kind: "recordings" | "submissions",
) {
  try {
    const learner = await services.identity.getCurrentLearner(request.headers);
    if (!learner) throw new PracticeError("unauthorized");
    if (request.method === "GET" && kind === "submissions") {
      const submissionId =
        new URL(request.url).searchParams.get("submissionId") ?? "";
      return json({
        attempt: await services.practice.findSubmission(
          learner,
          id,
          submissionId,
        ),
      });
    }
    if (request.method !== "POST")
      return json({ message: "不支持此操作。" }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ message: "请求来源无效，请在本站重新操作。" }, 403);
    if (kind === "recordings") {
      // Authorize before reading a potentially large body; the operation rechecks again.
      await services.practice.read(learner, id);
      return json(
        await services.practice.saveRecording(learner, id, {
          bytes: await bytes(request, 12 * 1024 * 1024),
          mediaType: request.headers.get("content-type") ?? "",
        }),
        201,
      );
    }
    const parsed = z
      .object({ submissionId: z.uuid(), reference: z.string().max(250) })
      .strict()
      .safeParse(
        await bytes(request, 4096)
          .then((value) => JSON.parse(value.toString()))
          .catch(() => null),
      );
    if (!parsed.success) throw new PracticeError("invalid");
    return json(
      await services.practice.submit(
        learner,
        id,
        parsed.data.submissionId,
        parsed.data.reference,
      ),
      201,
    );
  } catch (error) {
    if (isPracticeError(error))
      return json(
        { code: error.code, message: error.message },
        error.code === "unauthorized"
          ? 401
          : error.code === "not-found"
            ? 404
            : error.code === "conflict" || error.code === "ended"
              ? 409
              : error.code === "recording-unavailable"
                ? 503
                : 400,
      );
    return json(
      { message: "暂时无法核对接收结果，请保留本次提交并稍后核对。" },
      503,
    );
  }
}
