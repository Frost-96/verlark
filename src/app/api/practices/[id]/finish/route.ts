import { getServices } from "@/server/composition";
import { handleFinishRequest } from "../../finish-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await handleFinishRequest(request, getServices(), (await params).id);
  } catch {
    return Response.json(
      { message: "结束结果尚未确认，请查询结束状态后再决定是否重试。" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
