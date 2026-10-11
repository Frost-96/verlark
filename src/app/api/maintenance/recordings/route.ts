import { timingSafeEqual, createHash } from "node:crypto";
import { getServices } from "@/server/composition";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const headers = { "Cache-Control": "private, no-store" };
  if (
    !secret ||
    !timingSafeEqual(
      digest(request.headers.get("authorization") ?? ""),
      digest(`Bearer ${secret}`),
    )
  )
    return Response.json(
      { message: "需要维护授权。" },
      { status: 401, headers },
    );
  const { files } = getServices();
  if (!files.cleanupBatch || !files.maintenanceStatus)
    return Response.json(
      { message: "私有录音清理尚未配置。" },
      { status: 503, headers },
    );
  try {
    const batch = await files.cleanupBatch();
    const status = await files.maintenanceStatus();
    return Response.json(
      {
        ...batch,
        ...status,
        attentionRequired:
          status.scanOverdue || status.cleanupOverdue || batch.pending > 0,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { message: "扫描失败或结果未知，需要维护者检查；不能视为清理完成。" },
      { status: 503, headers },
    );
  }
}
