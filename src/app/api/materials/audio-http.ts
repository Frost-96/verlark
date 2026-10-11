import type { createIdentity } from "../../../modules/identity/server";
import type { LearningContent } from "../../../modules/learning-content/server";
import { isContentError } from "../../../modules/learning-content/contracts";

type Services = {
  identity: Pick<ReturnType<typeof createIdentity>, "getCurrentLearner">;
  content: LearningContent;
};
const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
export async function handleMaterialAudio(
  request: Request,
  services: Services,
  id: string,
) {
  try {
    if (!(await services.identity.getCurrentLearner(request.headers)))
      return new Response(null, { status: 401, headers: privateHeaders });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, {
        status: 405,
        headers: { ...privateHeaders, Allow: "GET, HEAD" },
      });
    const bytes = await services.content.readAudio(id);
    const headers = new Headers({
      ...privateHeaders,
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Content-Length": String(bytes.length),
    });
    if (request.method === "HEAD") return new Response(null, { headers });
    const range = request.headers.get("range");
    let start = 0;
    let end = bytes.length - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let valid = Boolean(
        match && (match[1] || match[2]) && range.length <= 80,
      );
      if (match) {
        if (!match[1]) {
          const count = Number(match[2]);
          valid &&= Number.isSafeInteger(count) && count > 0;
          start = Math.max(0, bytes.length - count);
        } else {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
          valid &&= Number.isSafeInteger(start) && Number.isSafeInteger(end);
        }
      }
      if (!valid || start > end || start >= bytes.length)
        return new Response(null, {
          status: 416,
          headers: {
            ...privateHeaders,
            "Content-Range": `bytes */${bytes.length}`,
          },
        });
      headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
      headers.set("Content-Length", String(end - start + 1));
    }
    return new Response(Uint8Array.from(bytes.subarray(start, end + 1)), {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    return new Response(null, {
      status: isContentError(error) ? 404 : 503,
      headers: privateHeaders,
    });
  }
}
