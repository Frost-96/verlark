"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function StartPractice({ materialKey }: { materialKey: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  async function start() {
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/practices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialKey, requestId: requestId.current }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "暂时无法开始，请稍后重试。");
        setPending(false);
        return;
      }
      router.push(`/practice/${result.id}`);
      router.refresh();
    } catch {
      setError(
        "未能确认练习是否已保存，请先到练习记录查看，再决定是否重新开始。",
      );
      setPending(false);
    }
  }
  return (
    <>
      <button type="button" disabled={pending} onClick={start}>
        {pending ? "正在保存练习…" : "开始聆听练习"}
      </button>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
    </>
  );
}
