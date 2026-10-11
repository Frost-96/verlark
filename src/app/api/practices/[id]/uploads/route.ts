import { getServices } from "@/server/composition";
import { handleUploadRequest } from "../../audio-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleUploadRequest(request, getServices(), (await context.params).id);
}
