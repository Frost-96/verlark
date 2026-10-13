import { timingSafeEqual, createHash } from "node:crypto";
import type { RecordingFiles } from "../../../../integrations/files/contracts";
import type { LearningContent } from "../../../../modules/learning-content/server";
import type { createPractice } from "../../../../modules/practice/server";

type MaintenanceServices = {
  files: RecordingFiles;
  content: LearningContent;
  practice: Pick<ReturnType<typeof createPractice>, "pruneDeletionReceipts">;
};
export async function handleRecordingMaintenance(
  request: Request,
  getServices: () => MaintenanceServices,
  secret: string | undefined,
) {
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
  if (request.method !== "GET")
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: "GET" },
    });
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== null && mode !== "status")
    return Response.json(
      { message: "维护模式无效。" },
      { status: 400, headers },
    );
  try {
    const { files, practice, content } = getServices();
    if (!files.cleanupBatch || !files.maintenanceStatus)
      return Response.json(
        { message: "私有录音清理尚未配置。", attentionRequired: true },
        { status: 503, headers },
      );
    // A read-only health check must never make a missed cron look successful.
    if (mode === "status") {
      const [status, materials] = await Promise.all([
        files.maintenanceStatus(),
        content.audioMaintenanceStatus(),
      ]);
      return Response.json(
        {
          ...status,
          materials,
          attentionRequired:
            status.scanOverdue ||
            status.cleanupOverdue ||
            status.actionableDue > 0 ||
            status.actionablePending > 0 ||
            materials.pending > 0,
        },
        { headers },
      );
    }
    // Independent bounded batches run together: a slow/failing provider for one
    // kind of audio must not prevent maintenance of the other kind.
    const [recordings, materials, receipts] = await Promise.allSettled([
      files.cleanupBatch(),
      content.cleanupAudio(),
      practice.pruneDeletionReceipts(),
    ]);
    const [status, materialStatus] = await Promise.all([
      files.maintenanceStatus(),
      content.audioMaintenanceStatus(),
    ]);
    const failed = [recordings, materials, receipts].some(
      (result) => result.status === "rejected",
    );
    const batch = recordings.status === "fulfilled" ? recordings.value : null;
    const materialBatch =
      materials.status === "fulfilled" ? materials.value : null;
    return Response.json(
      {
        ...batch,
        ...status,
        materials: { ...materialBatch, ...materialStatus },
        failures: {
          recordings: recordings.status === "rejected",
          materials: materials.status === "rejected",
          receipts: receipts.status === "rejected",
        },
        attentionRequired:
          failed ||
          status.scanOverdue ||
          status.cleanupOverdue ||
          status.actionableDue > 0 ||
          status.actionablePending > 0 ||
          (materialBatch?.failed ?? 0) > 0 ||
          materialStatus.pending > 0,
      },
      { status: failed ? 503 : 200, headers },
    );
  } catch {
    return Response.json(
      {
        message: "扫描失败或结果未知，需要维护者检查；不能视为清理完成。",
        attentionRequired: true,
      },
      { status: 503, headers },
    );
  }
}
