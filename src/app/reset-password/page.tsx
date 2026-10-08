import { AuthForm } from "@/modules/identity/ui/auth-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const query = await searchParams;
  return (
    <>
      {(!query.token || query.error) && (
        <p className="message error" role="alert">
          链接无效、已过期或已使用，请重新申请。
        </p>
      )}
      <AuthForm
        mode="reset"
        token={query.token}
        developmentMail={
          process.env.NODE_ENV !== "production" &&
          process.env.DEVELOPMENT_MAIL === "true"
        }
      />
    </>
  );
}
