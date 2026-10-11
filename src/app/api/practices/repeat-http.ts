import { readBoundedJSON } from "./read-json";
import { z } from "zod";
import { isContentError } from "../../../modules/learning-content/contracts";
import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  isPracticeError,
  PracticeError,
} from "../../../modules/practice/contracts";
const command = z.object({ requestId: z.uuid() }).strict();
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function handleRepeatRequest(
  request: Request,
  services: { identity: ReturnType<typeof createIdentity>; practice: Practice },
  id: string,
) {
  try {
    const learner = await services.identity.getCurrentLearner(request.headers);
    if (!learner) throw new PracticeError("unauthorized");
    if (request.method !== "POST")
      return json({ message: "不支持此操作。" }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ message: "请求来源无效，请在本站重新操作。" }, 403);
    const body = await readBoundedJSON(request, 1024);
    const parsed = command.safeParse(body);
    if (!parsed.success) throw new PracticeError("invalid");
    return json(
      await services.practice.repeat(learner, id, parsed.data.requestId),
      201,
    );
  } catch (error) {
    if (isContentError(error))
      return json({ code: error.code, message: error.message }, 409);
    if (isPracticeError(error))
      return json(
        { code: error.code, message: error.message },
        error.code === "unauthorized"
          ? 401
          : error.code === "not-found"
            ? 404
            : error.code === "conflict"
              ? 409
              : error.code === "feedback-unavailable"
                ? 503
                : 400,
      );
    return json(
      {
        message: "暂时无法确认重练是否已保存，请查看练习记录，或用原请求重试。",
      },
      503,
    );
  }
}
