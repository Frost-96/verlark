"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function SessionActions() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function run(operation: "sign-out" | "revoke-sessions") {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/auth/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        setMessage("操作未完成，请重试。会话撤销成功前不会显示已退出。");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setMessage("网络中断，请重试以确认会话是否已撤销。");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="actions">
        <button disabled={pending} onClick={() => run("sign-out")}>
          退出当前登录
        </button>
        <button
          className="secondary"
          disabled={pending}
          onClick={() => run("revoke-sessions")}
        >
          退出所有设备
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
