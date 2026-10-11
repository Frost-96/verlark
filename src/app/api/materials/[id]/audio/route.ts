import { getServices } from "../../../../../server/composition";
import { handleMaterialAudio } from "../../audio-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleMaterialAudio(request, getServices(), (await context.params).id);
}
export const HEAD = GET;
