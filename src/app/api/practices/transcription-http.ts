import { z } from "zod";
import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  isPracticeError,
  PracticeError,
} from "../../../modules/practice/contracts";
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recognize") }).strict(),
  z.object({ action: z.literal("recover") }).strict(),
  z
    .object({
      action: z.literal("confirm"),
      rawTranscriptId: z.uuid(),
      expectedConfirmationId: z.uuid().nullable(),
      text: z.string().max(20_000),
    })
    .strict(),
]);
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function handleTranscriptionRequest(
  request: Request,
  services: { identity: ReturnType<typeof createIdentity>; practice: Practice },
  id: string,
  attemptId: string,
) {
  try {
    const learner = await services.identity.getCurrentLearner(request.headers);
    if (!learner) throw new PracticeError("unauthorized");
    if (request.method !== "POST")
      return json({ message: "不支持此操作。" }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ message: "请求来源无效，请在本站重新操作。" }, 403);
    const reader = request.body?.getReader();
    if (!reader) throw new PracticeError("invalid");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 100_000) {
          await reader.cancel();
          throw new PracticeError("invalid");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new PracticeError("invalid");
    }
    const parsed = command.safeParse(body);
    if (!parsed.success) throw new PracticeError("invalid");
    const input = parsed.data;
    if (input.action === "recognize")
      return json(await services.practice.recognize(learner, id, attemptId));
    if (input.action === "recover")
      return json(
        await services.practice.recoverRecognition(learner, id, attemptId),
      );
    const confirmation = {
      rawTranscriptId: input.rawTranscriptId,
      expectedConfirmationId: input.expectedConfirmationId,
      text: input.text,
    };
    return json(
      await services.practice.confirmTranscript(
        learner,
        id,
        attemptId,
        confirmation,
      ),
    );
  } catch (error) {
    if (isPracticeError(error))
      return json(
        { code: error.code, message: error.message },
        error.code === "unauthorized"
          ? 401
          : error.code === "not-found"
            ? 404
            : ["processing", "stale", "ended"].includes(error.code)
              ? 409
              : error.code === "transcription-unavailable"
                ? 503
                : 400,
      );
    return json(
      {
        message:
          "暂时无法核对处理结果。请查询最新状态；你的编辑仍保留在当前页面。",
      },
      503,
    );
  }
}
