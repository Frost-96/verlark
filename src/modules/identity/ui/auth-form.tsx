"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authErrorMessage } from "../contracts";

type Mode = "login" | "signup" | "forgot" | "reset" | "verify";
const titles = {
  login: "欢迎回来",
  signup: "注册测试账号",
  forgot: "找回密码",
  reset: "设置新密码",
  verify: "验证邮箱",
};
export function AuthForm({
  mode,
  token,
  developmentMail,
}: {
  mode: Mode;
  token?: string;
  developmentMail: boolean;
}) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFailed(false);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const endpoints = {
      login: "sign-in/email",
      signup: "sign-up/email",
      forgot: "request-password-reset",
      reset: "reset-password",
      verify: "verify-email",
    };
    const body =
      mode === "signup"
        ? {
            email,
            password,
            name: String(data.get("name")),
            callbackURL: "/login",
          }
        : mode === "login"
          ? { email, password }
          : mode === "forgot"
            ? { email, redirectTo: "/reset-password" }
            : { token, newPassword: password };
    try {
      const response = await fetch(
        `/api/auth/${endpoints[mode]}${mode === "verify" ? `?token=${encodeURIComponent(token ?? "")}` : ""}`,
        {
          method: mode === "verify" ? "GET" : "POST",
          headers: { "Content-Type": "application/json" },
          ...(mode === "verify" ? {} : { body: JSON.stringify(body) }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setFailed(true);
        setMessage(result.message ?? authErrorMessage(result.code));
        return;
      }
      if (mode === "login") {
        router.replace("/account");
        router.refresh();
        return;
      }
      setMessage(
        mode === "signup"
          ? "注册请求已完成。若该邮箱符合条件，请打开验证链接后再登录。"
          : mode === "forgot"
            ? "若该邮箱已注册，将生成密码重置邮件。"
            : mode === "verify"
              ? "邮箱验证成功，现在可以登录。"
              : "密码已重置，所有旧会话已撤销，请使用新密码登录。",
      );
    } catch {
      setFailed(true);
      setMessage("暂时无法连接，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }
  async function resend() {
    const emailInput = document.querySelector<HTMLInputElement>(
      'input[name="email"]',
    );
    if (!emailInput?.value || !emailInput.reportValidity()) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.value,
          callbackURL: "/login",
        }),
      });
      const result = await response.json();
      setFailed(!response.ok);
      setMessage(
        response.ok
          ? "若该邮箱尚未验证，将生成新的验证邮件。"
          : (result.message ?? authErrorMessage(result.code)),
      );
    } catch {
      setFailed(true);
      setMessage("暂时无法连接，请稍后重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="form-panel">
      <h1>{titles[mode]}</h1>
      <p>
        {mode === "signup"
          ? "仅限测试名单内的邮箱。密码至少 12 个字符。"
          : mode === "verify"
            ? "点击下方按钮确认邮箱归你所有。"
            : "用邮箱继续你的学习准备。"}
      </p>
      {developmentMail && (
        <p className="notice">
          开发邮件替身已启用：邮件仅写入本机
          .dev-mail，未投递到真实邮箱。请由本机开发者读取链接。
        </p>
      )}
      <form onSubmit={submit}>
        {mode === "signup" && (
          <label>
            称呼
            <input name="name" required maxLength={60} autoComplete="name" />
          </label>
        )}
        {["login", "signup", "forgot"].includes(mode) && (
          <label>
            邮箱
            <input name="email" type="email" required autoComplete="email" />
          </label>
        )}
        {["login", "signup", "reset"].includes(mode) && (
          <label>
            {mode === "reset" ? "新密码" : "密码"}
            <input
              name="password"
              type="password"
              required
              minLength={mode === "login" ? 1 : 12}
              maxLength={128}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
        )}
        <button
          disabled={pending || (["verify", "reset"].includes(mode) && !token)}
        >
          {pending
            ? "正在处理…"
            : {
                login: "登录",
                signup: "注册并验证邮箱",
                forgot: "发送重置链接",
                reset: "重置密码",
                verify: "确认验证邮箱",
              }[mode]}
        </button>
      </form>
      {message && (
        <p
          className={`message ${failed ? "error" : ""}`}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      {mode === "login" && (
        <button className="secondary" disabled={pending} onClick={resend}>
          重新发送验证链接
        </button>
      )}
      <p className="links">
        <Link href="/login">登录</Link>
        <Link href="/signup">注册</Link>
        <Link href="/forgot-password">找回密码</Link>
      </p>
    </section>
  );
}
