import { z } from "zod";
import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  isPracticeError,
  PracticeError,
} from "../../../modules/practice/contracts";
import { readBoundedJSON } from "./read-json";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function handleFinishRequest(
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
    if (
      !z
        .object({})
        .strict()
        .safeParse(await readBoundedJSON(request, 1024)).success
    )
      throw new PracticeError("invalid");
    return json(await services.practice.finish(learner, id));
  } catch (error) {
    if (isPracticeError(error))
      return json(
        { code: error.code, message: error.message },
        error.code === "unauthorized"
          ? 401
          : error.code === "not-found"
            ? 404
            : ["processing", "feedback-required"].includes(error.code)
              ? 409
              : 400,
      );
    return json(
      { message: "结束结果尚未确认，请查询结束状态后再决定是否重试。" },
      503,
    );
  }
}
