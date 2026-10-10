import Link from "next/link";
import { learningAccess } from "../learning-access";
import { StartPractice } from "@/modules/practice/ui/start-practice";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function MaterialsPage() {
  const { services } = await learningAccess();
  const materials = await services.content.listAvailable();
  return (
    <section className="intro">
      <p className="eyebrow">先听后用</p>
      <h1>选择听力材料</h1>
      <p>先听一段日常对话，再借助其中的表达说说自己的情况。</p>
      <p>
        <Link href="/practices">查看练习记录</Link>
      </p>
      {!materials.length && (
        <p className="notice">还没有已发布的材料，请稍后再来。</p>
      )}
      {materials.map((material) => (
        <article className="notice" key={material.id}>
          <h2>{material.title}</h2>
          <p>{material.summary}</p>
          <p>内容版本 {material.revision}</p>
          <StartPractice materialKey={material.materialKey} />
        </article>
      ))}
    </section>
  );
}
