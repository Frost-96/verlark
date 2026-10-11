import { getServices } from "@/server/composition";
import { handleRecordingMaintenance } from "./http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return handleRecordingMaintenance(
    request,
    getServices,
    process.env.CRON_SECRET,
  );
}
