"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PracticeError, isPracticeErrorCode } from "../contracts";
import { ContentError } from "../../learning-content/contracts";

export function RepeatPractice({
  id,
  available,
}: {
  id: string;
  available: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const router = useRouter();
  async function repeat() {
    if (pending) return;
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/practices/${id}/repeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "withdrawn")
          setError(new ContentError("withdrawn").message);
        else if (isPracticeErrorCode(result.code))
          setError(new PracticeError(result.code).message);
        else throw new Error("unknown");
        return;
      }
      if (typeof result.id !== "string" || !/^[0-9a-f-]{36}$/.test(result.id))
        throw new Error("unknown");
      router.push(`/practice/${result.id}`);
      router.refresh();
    } catch {
      setError(
        "暂时无法确认重练是否已保存，请查看练习记录，或点击重练按钮用原请求重试。",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="notice" aria-label="重练原内容版本">
      <h2>重练</h2>
      <p>
        按原内容版本开启新的练习，原练习、作答与反馈保留。当前未提交的录音会随离开丢失。
      </p>
      {!available && <p>{new ContentError("withdrawn").message}</p>}
      <button type="button" disabled={pending || !available} onClick={repeat}>
        {pending ? "正在保存重练…" : "按原版本重练"}
      </button>
      <p>
        <Link href="/materials">另选可用材料开始新练习</Link>
      </p>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
    </section>
  );
}
