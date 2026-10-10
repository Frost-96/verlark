"use client";
import { useEffect, useRef, useState } from "react";
import {
  isPracticeErrorCode,
  PracticeError,
  type Attempt,
  type Feedback,
} from "../contracts";

export function FeedbackReview({
  attempt,
  practiceId,
  ended,
  enabled,
  onUpdate,
  beginRequest,
}: {
  attempt: Attempt;
  practiceId: string;
  ended: boolean;
  enabled: boolean;
  beginRequest: () => number;
  onUpdate: (attempt: Attempt, sequence: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );
  async function act(
    action: "generate" | "recover" | "refresh",
    confirmationId: string,
  ) {
    const number = ++sequence.current;
    const stateSequence = beginRequest();
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timer = setTimeout(() => request.abort(), 70_000);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        action === "refresh"
          ? `/api/practices/${practiceId}`
          : `/api/practices/${practiceId}/attempts/${attempt.id}/feedback`,
        action === "refresh"
          ? { cache: "no-store", signal: request.signal }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action, confirmationId }),
              signal: request.signal,
            },
      );
      const data = await response.json();
      if (number !== sequence.current) return;
      if (!response.ok) {
        if (isPracticeErrorCode(data?.code)) throw new PracticeError(data.code);
        throw new Error("Unrecognized response");
      }
      const updated: Attempt =
        action === "refresh"
          ? data.attempts.find((item: Attempt) => item.id === attempt.id)
          : data;
      if (!updated) throw new PracticeError("not-found");
      onUpdate(updated, stateSequence);
    } catch (error) {
      if (number === sequence.current)
        setMessage(
          error instanceof PracticeError
            ? error.message
            : "请求结果尚未确认。请查询反馈状态；本地中断不表示远端已取消。已接收作答与确认文本会保留。",
        );
    } finally {
      clearTimeout(timer);
      if (number === sequence.current) setBusy(false);
    }
  }
  const latest = attempt.confirmations.at(-1);
  if (!latest) return <p>确认文本后，即可请求表达反馈。</p>;
  const current = attempt.feedback.find(
    (item) => item.confirmationId === latest.id,
  );
  function view(
    item: Feedback | undefined,
    confirmation: Attempt["confirmations"][number],
    historical: boolean,
  ) {
    return (
      <div className="feedback-result">
        <h4>
          {historical
            ? `历史反馈 · 依据确认文本版本 ${confirmation.revision}`
            : item?.status === "succeeded"
              ? "当前有效反馈"
              : "当前确认文本尚无有效反馈。"}
        </h4>
        <p>依据：确认文本版本 {confirmation.revision}</p>
        <p lang="en" className="transcript-text">
          {confirmation.text}
        </p>
        {item?.failure && <p className="message">{item.failure}</p>}
        {item?.status === "processing" && (
          <p role="status">
            反馈处理中。处理权到期时间：
            {new Date(item.leaseExpiresAt!).toLocaleTimeString("zh-CN")}
            。到期后可恢复状态，再重试同一确认文本；不表示远端已取消。
          </p>
        )}
        {item?.status === "unknown" && <p>反馈结果未知</p>}
        {item?.result && (
          <>
            <p>{item.result.summary}</p>
            {item.result.issues.length ? (
              <>
                <h5>影响理解的问题</h5>
                {item.result.issues.map((issue, index) => (
                  <div key={index}>
                    <p>英语原话</p>
                    <p lang="en" className="transcript-text">
                      {issue.original}
                    </p>
                    <p>{issue.explanation}</p>
                    <p>改进表达</p>
                    <p lang="en" className="transcript-text">
                      {issue.improved}
                    </p>
                  </div>
                ))}
              </>
            ) : (
              <p>没有需要纠正的问题。</p>
            )}
            {item.result.alternatives.length > 0 && (
              <>
                <h5>可选替代表达（原话不是错误）</h5>
                {item.result.alternatives.map((alternative, index) => (
                  <div key={index}>
                    <p lang="en" className="transcript-text">
                      {alternative.original}
                    </p>
                    <p>{alternative.explanation}</p>
                    <p lang="en" className="transcript-text">
                      {alternative.improved}
                    </p>
                  </div>
                ))}
              </>
            )}
            <details>
              <summary>生成依据</summary>
              <p>
                规则版本：{item.rulesVersion} · {item.provenance?.provider} /{" "}
                {item.provenance?.model}
              </p>
            </details>
          </>
        )}
        {!ended && (
          <div className="actions">
            {item?.status === "processing" ? (
              <button
                type="button"
                onClick={() => act("recover", confirmation.id)}
              >
                恢复超时反馈
              </button>
            ) : (
              item?.status !== "succeeded" && (
                <button
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => act("generate", confirmation.id)}
                >
                  {item ? "重试同一文本反馈" : "获取表达反馈"}
                </button>
              )
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => act("refresh", confirmation.id)}
            >
              查询反馈状态
            </button>
          </div>
        )}
      </div>
    );
  }
  const history = attempt.confirmations.filter(
    (item) =>
      item.id !== latest.id &&
      attempt.feedback.some((value) => value.confirmationId === item.id),
  );
  return (
    <section aria-label="表达反馈">
      <h3>表达反馈</h3>
      <p>反馈仅依据确认文本，不评价发音、语调或停顿。</p>
      {enabled ? (
        <p className="message">
          开发反馈替身：仅展示固定测试样例，不代表真实模型质量。支持样例：I will
          read tomorrow. / I will read a book this weekend. / I borrow you my
          book tomorrow. / I went tomorrow. I borrow you my book.
          其他文本会返回失败。
        </p>
      ) : (
        <p>反馈服务尚未配置，已接收作答与确认文本会保留。</p>
      )}
      {busy && <p role="status">正在核对反馈结果，可查询反馈状态。</p>}
      {message && (
        <p role="alert" className="message error">
          {message}
        </p>
      )}
      {view(current, latest, false)}
      {history.length > 0 && (
        <details>
          <summary>查看历史反馈</summary>
          {history.map((confirmation) => (
            <div key={confirmation.id}>
              {view(
                attempt.feedback.find(
                  (item) => item.confirmationId === confirmation.id,
                ),
                confirmation,
                true,
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
