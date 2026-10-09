import { z } from "zod";
import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  PracticeError,
  isPracticeError,
} from "../../../modules/practice/contracts";
import { isContentError } from "../../../modules/learning-content/contracts";

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
export async function handlePracticeRequest(
  request: Request,
  services: Services,
  id?: string,
): Promise<Response> {
  try {
    const learner = await services.identity.getCurrentLearner(request.headers);
    if (!learner) throw new PracticeError("unauthorized");
    if (request.method === "GET")
      return json(
        id
          ? await services.practice.read(learner, id)
          : await services.practice.list(learner),
      );
    if (request.method !== "POST" || id)
      return json({ message: "不支持此操作。" }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ message: "请求来源无效，请在本站重新操作。" }, 403);
    const parsed = z
      .object({ materialKey: z.string() })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new PracticeError("invalid");
    return json(
      await services.practice.start(learner, parsed.data.materialKey),
      201,
    );
  } catch (error) {
    if (isPracticeError(error))
      return json(
        { message: error.message },
        error.code === "unauthorized"
          ? 401
          : error.code === "not-found"
            ? 404
            : 400,
      );
    if (isContentError(error)) return json({ message: error.message }, 404);
    return json({ message: "练习暂时不可用，请稍后重试。" }, 503);
  }
}
