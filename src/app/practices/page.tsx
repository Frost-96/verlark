import { DeletePractice, DeletionStatus } from "@/modules/practice/ui/deletion";
import Link from "next/link";
import { learningAccess } from "../learning-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function PracticesPage() {
  const { services, learner } = await learningAccess();
  const records = await services.practice.list(learner);
  const deletions = await services.practice.listDeletions(learner);
  return (
    <section className="intro">
      <h1>练习记录</h1>
      <p>中途离开不会结束练习。继续时会使用开始练习时的内容版本。</p>
      <p>
        <Link href="/materials">选择听力材料</Link>
      </p>
      {!records.length && (
        <p className="notice">还没有练习记录。选择一份材料开始吧。</p>
      )}
      {records.map((record) => (
        <article className="notice" key={record.id}>
          <h2>{record.title}</h2>
          <p>
            {record.status === "in-progress" ? "未结束" : "已结束"} ·{" "}
            <time dateTime={record.createdAt}>
              {new Date(record.createdAt).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
                hour12: false,
              })}
              （北京时间）
            </time>
          </p>
          <Link className="button" href={`/practice/${record.id}`}>
            {record.status === "in-progress" ? "继续练习" : "查看记录"}
          </Link>
          <DeletePractice id={record.id} />
        </article>
      ))}
      {deletions.length > 0 && (
        <section aria-label="删除与录音清理">
          <h2>删除与录音清理</h2>
          <p>完整清理回执保留 30 天，可刷新查询和重试；之后仅保留删除标识。</p>
          {services.files.mode === "development" && (
            <p>开发录音清理 · 仅供本地流程验证，不代表真实存储验收。</p>
          )}
          {deletions.map((deletion) => (
            <DeletionStatus key={deletion.id} deletion={deletion} />
          ))}
        </section>
      )}
    </section>
  );
}
