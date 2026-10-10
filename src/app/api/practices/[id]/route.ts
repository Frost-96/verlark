import { getServices } from "@/server/composition";
import { handlePracticeRequest } from "../http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    return await handlePracticeRequest(request, getServices(), id);
  } catch {
    return Response.json(
      { message: "练习服务暂时不可用，请稍后重试。" },
      { status: 503 },
    );
  }
}
