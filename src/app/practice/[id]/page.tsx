import Link from "next/link";
import { notFound } from "next/navigation";
import { learningAccess } from "../../learning-access";
import { isPracticeError } from "@/modules/practice/contracts";
import { ListeningMaterial } from "@/modules/practice/ui/listening-material";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function PracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { services, learner } = await learningAccess();
  const { id } = await params;
  const practice = await services.practice
    .read(learner, id)
    .catch((error: unknown) => {
      if (isPracticeError(error) && error.code === "not-found") notFound();
      throw error;
    });
  return (
    <article className="intro">
      <div className="links">
        <Link href="/practices">返回练习记录</Link>
        <Link href="/materials">选择其他材料</Link>
      </div>
      <h1>{practice.title}</h1>
      <p>未结束 · 内容版本 {practice.content.revision}</p>
      <ListeningMaterial content={practice.content} />
    </article>
  );
}
