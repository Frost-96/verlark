import { getServices } from "@/server/composition";
import { handleDeletionRequest } from "../../deletion-http";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    return await handleDeletionRequest(request, getServices(), id);
  } catch {
    return Response.json(
      { message: "暂时无法核对删除结果，请刷新练习记录。" },
      { status: 503 },
    );
  }
}
export { handle as GET, handle as DELETE, handle as POST };
