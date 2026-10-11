import { getServices } from "@/server/composition";
import { handleAudioRequest } from "../../../../audio-http";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> },
) {
  const { id, attemptId } = await context.params;
  return handleAudioRequest(request, getServices(), id, attemptId);
}
export { handle as GET, handle as HEAD };
