import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/server/composition";
import { identityMessages } from "@/modules/identity/contracts";
import { SessionActions } from "@/modules/identity/ui/session-actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  const requestHeaders = await headers();
  const learner = await getServices()
    .identity.getCurrentLearner(requestHeaders)
    .catch(() => {
      throw new Error(identityMessages.unavailable);
    });
  if (!learner) redirect("/login");
  return (
    <section className="intro">
      <p className="eyebrow">我的账号</p>
      <h1>你好，{learner.name}</h1>
      <p>已验证邮箱：{learner.email}</p>
      <aside className="notice">
        <h2>学习内容准备中</h2>
        <p>还没有开放的听力材料与练习。账号验证不代表已完成学习。</p>
      </aside>
      <SessionActions />
    </section>
  );
}
