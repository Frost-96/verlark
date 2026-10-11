import "./load-env";
import { z } from "zod";

const [target, action] = process.argv.slice(2);
const secret = process.env.CRON_SECRET;
const statusSchema = z.object({
  lastRunAt: z.string().nullable(),
  lastCompletedScanAt: z.string().nullable(),
  due: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  scanOverdue: z.boolean(),
  cleanupOverdue: z.boolean(),
  materials: z.object({ pending: z.number().int().nonnegative() }),
  attentionRequired: z.boolean(),
});
try {
  if (
    !target ||
    !secret ||
    secret.length < 32 ||
    (action && action !== "--run")
  )
    throw new Error("configuration");
  const origin = new URL(target);
  if (origin.origin !== target || origin.protocol !== "https:")
    throw new Error("origin");
  const url = new URL("/api/maintenance/recordings", origin);
  if (action !== "--run") url.searchParams.set("mode", "status");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    console.error(
      `维护检查未通过（HTTP ${response.status}）；请核对部署、配置与权限。`,
    );
    process.exitCode = 2;
  } else {
    const result = statusSchema.parse(await response.json());
    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          action: action === "--run" ? "run" : "status",
          ...result,
        },
        null,
        2,
      ),
    );
    if (result.attentionRequired) {
      console.error("存在逾期、积压或未完成清理，需要维护者处理。");
      process.exitCode = 1;
    }
  }
} catch {
  console.error(
    "无法确认维护状态。用法：pnpm exec tsx scripts/check-media-maintenance.ts https://部署域名 [--run]；需配置 CRON_SECRET。结果未知不表示健康。",
  );
  process.exitCode = 2;
}
