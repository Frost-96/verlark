import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/server/composition";
import { identityMessages } from "@/modules/identity/contracts";
import { SessionActions } from "@/modules/identity/ui/session-actions";
import Link from "next/link";
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
        <h2>开始聆听</h2>
        <p>选择已发布的材料，或继续先前的练习。录音提交与反馈仍在准备中。</p>
        <div className="links">
          <Link href="/materials">选择听力材料</Link>
          <Link href="/practices">练习记录</Link>
        </div>
      </aside>
      <SessionActions />
    </section>
  );
}
