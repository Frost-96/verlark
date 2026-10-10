import { getServices } from "@/server/composition";
import { handleRecordingRequest } from "../../recording-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRecordingRequest(
    request,
    getServices(),
    (await context.params).id,
    "recordings",
  );
}
