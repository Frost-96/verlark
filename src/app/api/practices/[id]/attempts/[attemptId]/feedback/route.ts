import { getServices } from "@/server/composition";
import { handleFeedbackRequest } from "../../../../feedback-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> },
) {
  const { id, attemptId } = await context.params;
  return handleFeedbackRequest(request, getServices(), id, attemptId);
}
