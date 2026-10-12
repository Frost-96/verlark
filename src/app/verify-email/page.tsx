import { AuthForm } from "@/modules/identity/ui/auth-form";
import Link from "next/link";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const query = await searchParams;
  if (!query.token) {
    return (
      <section className="form-panel">
        <h1>验证邮箱</h1>
        <p className="message error" role="alert">
          验证链接不完整。请从最新的验证邮件打开完整链接。
        </p>
        <p>若找不到邮件，请在登录页填写邮箱，重新发送验证邮件。</p>
        <Link href="/login">重新申请验证邮件</Link>
      </section>
    );
  }
  return (
    <>
      {query.error && (
        <p className="message error" role="alert">
          链接无效、已过期或已使用，请重新申请。
        </p>
      )}
      <AuthForm
        mode="verify"
        token={query.token}
        developmentMail={
          process.env.NODE_ENV !== "production" &&
          process.env.DEVELOPMENT_MAIL === "true"
        }
      />
    </>
  );
}
