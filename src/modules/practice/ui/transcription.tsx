"use client";
import { FeedbackReview } from "./feedback";
import { useEffect, useRef, useState } from "react";
import { isPracticeErrorCode, PracticeError, type Attempt } from "../contracts";
const labels: Record<Attempt["status"], string> = {
  "pending-identification": "已接收 · 待识别",
  processing: "识别处理中",
  recognized: "识别完成 · 请核对",
  failed: "识别失败",
  unknown: "识别结果未知",
  "no-content": "未识别到可用内容",
};
function editorValue(attempt: Attempt) {
  return {
    text:
      attempt.confirmations.at(-1)?.text ?? attempt.rawTranscript?.text ?? "",
    rawTranscriptId: attempt.rawTranscript?.id ?? null,
    expectedConfirmationId: attempt.confirmations.at(-1)?.id ?? null,
  };
}
export function TranscriptionReview({
  initial,
  practiceId,
  ended,
  enabled,
  feedbackEnabled,
}: {
  initial: Attempt;
  practiceId: string;
  ended: boolean;
  enabled: boolean;
  feedbackEnabled: boolean;
}) {
  const [attempt, setAttempt] = useState(initial);
  const [editor, setEditor] = useState(() => editorValue(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const requestNumber = useRef(0);
  // Both controls read/write the same Attempt snapshot; a newer request supersedes older snapshots.
  const stateRequestNumber = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      requestNumber.current++;
      controller.current?.abort();
    },
    [],
  );
  async function act(action: "recognize" | "recover" | "confirm" | "refresh") {
    const sequence = ++requestNumber.current;
    const stateSequence = ++stateRequestNumber.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 70_000);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        action === "refresh"
          ? `/api/practices/${practiceId}`
          : `/api/practices/${practiceId}/attempts/${attempt.id}/transcription`,
        action === "refresh"
          ? { cache: "no-store", signal: request.signal }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(
                action === "confirm" ? { action, ...editor } : { action },
              ),
              signal: request.signal,
            },
      );
      const data = await response.json();
      if (sequence !== requestNumber.current) return;
      if (!response.ok) {
        // Response messages may come from a proxy; only known codes select local Chinese copy.
        if (isPracticeErrorCode(data?.code)) throw new PracticeError(data.code);
        throw new Error("Unrecognized response");
      }
      const updated: Attempt =
        action === "refresh"
          ? data.attempts.find((value: Attempt) => value.id === attempt.id)
          : data;
      if (!updated) throw new PracticeError("not-found");
      if (stateSequence !== stateRequestNumber.current) return;
      setAttempt(updated);
      // A refresh does not discard an unsaved correction or silently rebase it onto another version.
      if (action === "confirm" || !editor.rawTranscriptId)
        setEditor(editorValue(updated));
    } catch (error) {
      if (sequence === requestNumber.current)
        setMessage(
          error instanceof PracticeError
            ? error.message
            : "请求结果尚未确认。请查询最新状态；本地中断不表示远端已取消。你的编辑仍保留。",
        );
    } finally {
      clearTimeout(timeout);
      if (sequence === requestNumber.current) setBusy(false);
    }
  }
  const latest = attempt.confirmations.at(-1);
  const stale =
    editor.rawTranscriptId !== attempt.rawTranscript?.id ||
    editor.expectedConfirmationId !== (latest?.id ?? null);
  return (
    <div className="transcription-review">
      <p>{labels[attempt.status]}</p>
      {attempt.failure && <p className="message">{attempt.failure}</p>}
      {attempt.status === "processing" && (
        <p>
          处理权到期时间：
          {new Date(attempt.leaseExpiresAt!).toLocaleTimeString("zh-CN")}
          。到期后可恢复状态，再重试原录音。恢复不表示远端已取消。
        </p>
      )}
      {busy && <p role="status">正在核对处理结果，可查询最新状态。</p>}
      {message && (
        <p role="alert" className="message error">
          {message}
        </p>
      )}
      {!ended && (
        <div className="actions">
          {attempt.status !== "recognized" &&
            attempt.status !== "processing" && (
              <button
                type="button"
                disabled={busy || !enabled}
                onClick={() => act("recognize")}
              >
                {attempt.status === "pending-identification"
                  ? "识别本次录音"
                  : "重试原录音识别"}
              </button>
            )}
          {attempt.status === "processing" && (
            <button type="button" onClick={() => act("recover")}>
              恢复超时处理
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => act("refresh")}
          >
            查询最新状态
          </button>
        </div>
      )}
      {attempt.rawTranscript && (
        <>
          <h3>原始转写</h3>
          <p lang="en" className="transcript-text">
            {attempt.rawTranscript.text}
          </p>
          {latest && (
            <>
              <h3>确认文本 · 版本 {latest.revision}</h3>
              <p lang="en" className="transcript-text">
                {latest.text}
              </p>
            </>
          )}
          {!ended && (
            <>
              <p>
                只纠正识别错误，让文本还原你实际说的话。改进原本说法，请再次录音作答。
              </p>
              <p>尚未确认的编辑只保留在当前页面，刷新或离开可能丢失。</p>
              {stale && (
                <p className="message">
                  已有更新版本，你的编辑仍保留。请核对最新确认文本后再修改。
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("confirm");
                }}
              >
                <label>
                  核对后的英语文本
                  <textarea
                    disabled={busy}
                    lang="en"
                    rows={5}
                    maxLength={20_000}
                    value={editor.text}
                    onChange={(event) =>
                      setEditor({ ...editor, text: event.target.value })
                    }
                  />
                </label>
                <div className="actions">
                  <button disabled={busy || !editor.text.trim()} type="submit">
                    确认文本
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditor(editorValue(attempt));
                      setMessage("");
                    }}
                  >
                    载入最新确认文本
                  </button>
                </div>
              </form>
            </>
          )}
          {attempt.confirmations.length > 1 && (
            <details>
              <summary>查看此前确认文本</summary>
              {attempt.confirmations.slice(0, -1).map((item) => (
                <div key={item.id}>
                  <h4>确认文本 · 版本 {item.revision}</h4>
                  <p lang="en" className="transcript-text">
                    {item.text}
                  </p>
                </div>
              ))}
            </details>
          )}
        </>
      )}
      <FeedbackReview
        attempt={attempt}
        practiceId={practiceId}
        ended={ended}
        enabled={feedbackEnabled}
        beginRequest={() => ++stateRequestNumber.current}
        onUpdate={(updated, stateSequence) => {
          if (stateSequence === stateRequestNumber.current) setAttempt(updated);
        }}
      />
    </div>
  );
}
