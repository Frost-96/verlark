import { getServices } from "@/server/composition";
import { handlePracticeRequest } from "./http";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    return await handlePracticeRequest(request, getServices());
  } catch {
    return Response.json(
      { message: "练习服务暂时不可用，请稍后重试。" },
      { status: 503 },
    );
  }
}
export { handle as GET, handle as POST };
