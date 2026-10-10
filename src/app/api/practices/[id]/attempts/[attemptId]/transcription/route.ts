import { getServices } from "@/server/composition";
import { handleTranscriptionRequest } from "../../../../transcription-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> },
) {
  const { id, attemptId } = await context.params;
  return handleTranscriptionRequest(request, getServices(), id, attemptId);
}
