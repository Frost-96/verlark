import { z } from "zod";
import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  isPracticeError,
  PracticeError,
} from "../../../modules/practice/contracts";
const command = z
  .object({ action: z.enum(["generate", "recover"]), confirmationId: z.uuid() })
  .strict();
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function handleFeedbackRequest(
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
        if (size > 1024) {
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
    return json(
      await (input.action === "generate"
        ? services.practice.requestFeedback(
            learner,
            id,
            attemptId,
            input.confirmationId,
          )
        : services.practice.recoverFeedback(
            learner,
            id,
            attemptId,
            input.confirmationId,
          )),
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
              : error.code === "feedback-unavailable"
                ? 503
                : 400,
      );
    return json(
      {
        message:
          "暂时无法核对反馈结果。请查询最新状态；已接收作答与确认文本会保留。",
      },
      503,
    );
  }
}
