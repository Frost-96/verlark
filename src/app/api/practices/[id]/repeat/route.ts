import { getServices } from "@/server/composition";
import { handleRepeatRequest } from "../../repeat-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await handleRepeatRequest(request, getServices(), (await params).id);
  } catch {
    return Response.json(
      { message: "重练服务暂时不可用，请稍后重试。" },
      { status: 503 },
    );
  }
}
