"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PracticeDeletion } from "../contracts";

export function DeletePractice({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/practices/${id}/deletion`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error((await response.json()).message);
      router.replace("/practices");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "无法核对删除结果，请刷新练习记录。",
      );
      setBusy(false);
    }
  }
  return (
    <div>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)}>
          删除整次练习
        </button>
      ) : (
        <div className="notice">
          <p>
            删除后无法恢复本次练习、全部作答与反馈。录音清理结果会保留在练习记录页。
          </p>
          <div className="links">
            <button type="button" disabled={busy} onClick={remove}>
              {busy ? "正在删除…" : "确认删除整次练习"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function DeletionStatus({ deletion }: { deletion: PracticeDeletion }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/practices/${deletion.id}/deletion`, {
        method: "POST",
      });
      if (!response.ok) throw new Error((await response.json()).message);
      router.refresh();
    } catch {
      setError("暂时无法核对清理结果，请稍后刷新或重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="notice" aria-label="已删除练习的清理状态">
      <h3>练习记录已删除</h3>
      <p>
        <time dateTime={deletion.deletedAt}>
          {new Date(deletion.deletedAt).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          })}
          （北京时间）
        </time>
      </p>
      <p>
        {deletion.status === "succeeded"
          ? "开发录音清理已执行。"
          : deletion.status === "processing"
            ? "录音清理正在处理；若请求失联，一分钟后可重试清理。"
            : (deletion.failure ?? "录音尚待清理，请重试清理。")}
      </p>
      <button type="button" disabled={busy} onClick={retry}>
        {busy
          ? "正在核对清理…"
          : deletion.status === "succeeded"
            ? "再次检查录音清理"
            : "重试录音清理"}
      </button>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
