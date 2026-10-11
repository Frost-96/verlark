"use client";
import { useState } from "react";
import {
  isPracticeErrorCode,
  PracticeError,
  type PracticeDetail,
} from "../contracts";

export function FinishPractice({
  id,
  ended,
  onEnded,
}: {
  id: string;
  ended: boolean;
  onEnded: (practice: PracticeDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: "finish" | "read") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/practices/${id}${action === "finish" ? "/finish" : ""}`,
        action === "finish"
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
              signal: AbortSignal.timeout(15000),
            }
          : { cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      const result = await response.json();
      if (!response.ok) {
        if (isPracticeErrorCode(result?.code))
          throw new PracticeError(result.code);
        throw new Error("Unrecognized response");
      }
      if (result.status === "ended") {
        onEnded(result);
        return;
      }
      if (result.status !== "in-progress")
        throw new Error("Unrecognized response");
      setMessage("练习仍未结束。请核对各次作答与处理状态，再结束本次练习。");
    } catch (error) {
      setMessage(
        error instanceof PracticeError
          ? error.message
          : "结束结果尚未确认。请查询结束状态后再决定是否重试；本地中断不表示远端已取消。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="结束练习">
      {ended ? (
        <p className="notice">
          练习已结束，记录只读。不能追加作答、更正文本或重试处理；仍可围绕原版重练或删除整次练习。结束不等于掌握表达。
        </p>
      ) : (
        <>
          <p>
            至少一份当前有效反馈且没有处理中请求时可以结束，其他作答可以保留失败或未核对状态。结束后记录只读；未提交录音和未确认编辑不会保存。
          </p>
          {message && (
            <p role="alert" className="message error">
              {message}
            </p>
          )}
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => act("finish")}>
              {busy ? "正在核对结束状态…" : "结束本次练习"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => act("read")}
            >
              查询结束状态
            </button>
          </div>
        </>
      )}
    </section>
  );
}
