import { AuthForm } from "@/modules/identity/ui/auth-form";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <AuthForm
      mode="login"
      developmentMail={
        process.env.NODE_ENV !== "production" &&
        process.env.DEVELOPMENT_MAIL === "true"
      }
    />
  );
}
