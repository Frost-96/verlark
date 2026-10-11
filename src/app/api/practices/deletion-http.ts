import type { createIdentity } from "../../../modules/identity/server";
import type { Practice } from "../../../modules/practice/server";
import {
  isPracticeError,
  PracticeError,
} from "../../../modules/practice/contracts";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function handleDeletionRequest(
  request: Request,
  services: { identity: ReturnType<typeof createIdentity>; practice: Practice },
  id: string,
) {
  try {
    const learner = await services.identity.getCurrentLearner(request.headers);
    if (!learner) throw new PracticeError("unauthorized");
    if (request.method === "GET")
      return json(await services.practice.readDeletion(learner, id));
    if (!["DELETE", "POST"].includes(request.method))
      return json({ message: "不支持此操作。" }, 405);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ message: "请求来源无效，请在本站重新操作。" }, 403);
    // No client-supplied identity or options are needed by either operation.
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.length) {
            await reader.cancel();
            throw new PracticeError("invalid");
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    return json(
      await (request.method === "DELETE"
        ? services.practice.delete(learner, id)
        : services.practice.retryDeletion(learner, id)),
    );
  } catch (error) {
    if (isPracticeError(error))
      return json(
        { code: error.code, message: error.message },
        error.code === "unauthorized"
          ? 401
          : error.code === "not-found"
            ? 404
            : 400,
      );
    return json(
      { message: "暂时无法核对删除结果。请刷新练习记录，查看删除与清理状态。" },
      503,
    );
  }
}
