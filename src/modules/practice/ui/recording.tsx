"use client";
import { TranscriptionReview } from "./transcription";

import { useEffect, useRef, useState } from "react";
import type { Attempt, PracticeDetail } from "../contracts";

type Pending = { submissionId: string; reference: string };
type Draft = { blob: Blob; url: string; submissionId: string };
type Phase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "draft"
  | "sending"
  | "uncertain";
const limit = 12 * 1024 * 1024;

export function Recording({ practice }: { practice: PracticeDetail }) {
  const [attempts, setAttempts] = useState(practice.attempts);
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(false);
  const generation = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const objectURL = useRef<string | null>(null);
  const busy = useRef(false);
  const keyPrefix = `verlark:submission:${practice.id}:`;
  const submissionKey = (id: string) => `${keyPrefix}${id}`;
  const base = `/api/practices/${practice.id}`;

  function releaseCapture() {
    const active = recorder.current;
    recorder.current = null;
    if (active) {
      active.ondataavailable = active.onstop = active.onerror = null;
      if (active.state !== "inactive") active.stop();
    }
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
  }
  function clearDraft() {
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    objectURL.current = null;
    setDraft(null);
  }
  function rememberAccepted(item: Attempt) {
    setAttempts((items) =>
      items.some((value) => value.id === item.id) ? items : [...items, item],
    );
    try {
      localStorage.removeItem(submissionKey(item.submissionId));
    } catch {
      /* The durable record is already accepted; a later lookup can clear the marker. */
    }
  }
  async function lookup(
    value: Pending,
    signal?: AbortSignal,
  ): Promise<Attempt | null> {
    const response = await fetch(
      `${base}/submissions?submissionId=${encodeURIComponent(value.submissionId)}`,
      {
        cache: "no-store",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error();
    return (await response.json()).attempt;
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const controller = new AbortController();
    // Each unresolved ID has its own key: concurrent tabs never overwrite each other.
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      try {
        const keys = Object.keys(localStorage);
        const values: Pending[] = [];
        for (const storedKey of keys) {
          if (!storedKey?.startsWith(keyPrefix)) continue;
          const raw = localStorage.getItem(storedKey);
          if (!raw) continue;
          const value: Pending = JSON.parse(raw);
          if (
            typeof value.submissionId !== "string" ||
            typeof value.reference !== "string" ||
            storedKey !== submissionKey(value.submissionId)
          )
            throw new Error();
          values.push(value);
        }
        setPending(values);
        if (values.length) setPhase("uncertain");
        const results = await Promise.allSettled(
          values.map((value) => lookup(value, controller.signal)),
        );
        // Effect replay/unmount invalidates this run even if a fetch ignores cancellation.
        if (cancelled) return;
        const unresolved: Pending[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled" && result.value)
            rememberAccepted(result.value);
          else unresolved.push(values[index]!);
        });
        setPending(unresolved);
        setPhase(unresolved.length ? "uncertain" : "idle");
        if (results.some((result) => result.status === "rejected"))
          setMessage("暂时无法核对上次提交，请检查网络后重试。");
        else if (unresolved.length)
          setMessage(
            "尚未查到接收记录；先核对并重发同一次提交，避免重复作答。",
          );
      } catch {
        if (!cancelled)
          setMessage("暂时无法核对上次提交，请检查网络及浏览器存储后重试。");
      } finally {
        if (!cancelled) setInitialized(true);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
      alive.current = false;
      // This counter invalidates outstanding permission requests, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      releaseCapture();
      if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    };
    // The component is keyed by practice ID. Only this effect instance may finish entry recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyPrefix]);

  const dirty = Boolean(
    draft ||
    pending.length ||
    phase === "recording" ||
    phase === "requesting" ||
    phase === "stopping",
  );
  useEffect(() => {
    if (!dirty) return;
    const warning =
      "未提交录音离开后可能丢失；接收结果未确认时，再次进入将先核对本次提交。确定离开吗？";
    function unload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function navigate(event: MouseEvent) {
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      if (
        new URL(anchor.href).pathname === location.pathname &&
        new URL(anchor.href).search === location.search
      )
        return;
      if (!window.confirm(warning)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);

  async function start() {
    if (busy.current || pending.length || !initialized) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setMessage(
        "当前浏览器无法录音，请使用支持麦克风的新版浏览器，并通过 HTTPS 或本机开发地址打开。",
      );
      return;
    }
    busy.current = true;
    clearDraft();
    setMessage("");
    setPhase("requesting");
    const token = ++generation.current;
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!alive.current || generation.current !== token) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = acquired;
      const mediaType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(
        acquired,
        mediaType ? { mimeType: mediaType } : undefined,
      );
      recorder.current = active;
      const parts: Blob[] = [];
      let size = 0;
      function fail(text: string) {
        if (generation.current !== token) return;
        generation.current++;
        releaseCapture();
        busy.current = false;
        if (alive.current) {
          setPhase("idle");
          setMessage(text);
        }
      }
      active.ondataavailable = (event) => {
        if (!event.data.size) return;
        size += event.data.size;
        if (size > limit) {
          fail("录音超过当前开发上传限制（12 MB），请缩短录音后重录。");
          return;
        }
        parts.push(event.data);
      };
      active.onerror = () =>
        fail("录音采集失败，请检查麦克风是否被占用后重新录音。");
      acquired.getTracks().forEach((track) => {
        track.onended = () => {
          if (active.state === "recording")
            fail("麦克风已断开，请连接或授权后重新录音。");
        };
      });
      active.onstop = () => {
        if (generation.current !== token) return;
        const blob = new Blob(parts, {
          type: active.mimeType || mediaType || "audio/webm",
        });
        releaseCapture();
        busy.current = false;
        if (!alive.current || generation.current !== token) return;
        if (!blob.size) {
          setPhase("idle");
          setMessage("没有采集到录音，请检查麦克风后重录。");
          return;
        }
        const url = URL.createObjectURL(blob);
        objectURL.current = url;
        setDraft({ blob, url, submissionId: crypto.randomUUID() });
        setPhase("draft");
      };
      active.start(250);
      setPhase("recording");
    } catch (error) {
      if (generation.current !== token) return;
      releaseCapture();
      if (alive.current && generation.current === token) {
        setPhase("idle");
        setMessage(
          error instanceof DOMException &&
            (error.name === "NotAllowedError" || error.name === "SecurityError")
            ? "麦克风权限被拒绝，请在浏览器的网站设置中允许麦克风，再重新录音。"
            : "无法采集录音，请检查麦克风连接、系统权限或是否被其他应用占用，再重新录音。",
        );
      }
    } finally {
      if (generation.current === token) busy.current = false;
    }
  }
  function discard() {
    generation.current++;
    releaseCapture();
    busy.current = false;
    clearDraft();
    setPhase("idle");
    setMessage("");
  }
  async function send(recover = false) {
    if (busy.current || !initialized || (!pending.length && !draft)) return;
    busy.current = true;
    setPhase("sending");
    setMessage("");
    let value = pending[0] ?? null;
    function complete(item: Attempt) {
      rememberAccepted(item);
      const remaining = pending.filter(
        (other) => other.submissionId !== item.submissionId,
      );
      setPending(remaining);
      const ownsDraft = draft?.submissionId === item.submissionId;
      if (ownsDraft) clearDraft();
      setPhase(
        remaining.length ? "uncertain" : draft && !ownsDraft ? "draft" : "idle",
      );
      setMessage(remaining.length ? "还有未核对的提交，请逐一核对。" : "");
    }
    try {
      if (recover && value) {
        const found = await lookup(value);
        if (!alive.current) return;
        if (found) {
          complete(found);
          return;
        }
      }
      if (!value && draft) {
        const upload = await fetch(`${base}/recordings`, {
          method: "POST",
          headers: { "Content-Type": draft.blob.type },
          body: draft.blob,
          signal: AbortSignal.timeout(30000),
        });
        if (!upload.ok) throw new Error("upload");
        const recording = await upload.json();
        const candidate = {
          submissionId: draft.submissionId,
          reference: recording.reference,
        };
        if (!alive.current) return;
        // If persistence fails, do not send an acceptance request we cannot safely recover.
        try {
          localStorage.setItem(
            submissionKey(candidate.submissionId),
            JSON.stringify(candidate),
          );
        } catch {
          setPhase("draft");
          setMessage(
            "无法保存提交标识，请允许本站使用浏览器存储后再提交；录音仍在此页面。",
          );
          return;
        }
        value = candidate;
        setPending((items) => [
          ...items.filter(
            (item) => item.submissionId !== candidate.submissionId,
          ),
          candidate,
        ]);
      }
      if (!value || !alive.current) return;
      const response = await fetch(`${base}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (result?.code === "recording-invalid" || result?.code === "ended") {
          localStorage.removeItem(submissionKey(value.submissionId));
          const rejectedId = value.submissionId;
          const remaining = pending.filter(
            (item) => item.submissionId !== rejectedId,
          );
          setPending(remaining);
          setPhase(remaining.length ? "uncertain" : draft ? "draft" : "idle");
          setMessage(result.message);
          return;
        }
        throw new Error();
      }
      const item = await response.json();
      if (alive.current) complete(item);
    } catch {
      if (alive.current) {
        setPhase(value ? "uncertain" : "draft");
        setMessage(
          value
            ? "接收结果尚未确认，请核对并重发同一次提交；不要重新创建作答。"
            : "录音尚未提交，请检查网络后重试；草稿仍可试听。",
        );
      }
    } finally {
      busy.current = false;
    }
  }

  return (
    <section aria-labelledby="recording-heading">
      <h2 id="recording-heading">录下你的表达</h2>
      <p className="notice">
        未提交录音仅临时保存在此页面，刷新或离开后可能丢失。试听、丢弃和重录不计入作答；主动提交并被接收后才进入记录。
      </p>
      {practice.recordingMode === "development" ? (
        <p className="eyebrow">
          开发录音文件 · 仅供本地流程验证；真实存储与保留规则待确定。
        </p>
      ) : (
        <p>录音存储尚未配置，暂时不能提交。</p>
      )}
      <p>
        {practice.transcriptionMode === "development"
          ? "开发识别用于流程验证；真实识别与表达反馈尚未接入。"
          : "识别服务与表达反馈尚未接入。"}
        单次录音开发上传限制为 12 MB。
      </p>
      {message && (
        <p role="alert" className="message error">
          {message}
        </p>
      )}
      {!initialized && <p role="status">正在核对上次提交…</p>}
      {phase === "requesting" && <p role="status">请在浏览器中允许麦克风。</p>}
      {phase === "recording" && (
        <p role="status">正在录音 · 说完后点击停止录音。</p>
      )}
      {phase === "stopping" && <p role="status">正在保存录音草稿…</p>}
      {phase === "sending" && <p role="status">正在核对并提交，请稍候…</p>}
      {draft && <audio aria-label="录音草稿试听" src={draft.url} controls />}
      <div className="actions">
        {(phase === "idle" || phase === "draft") && !pending.length && (
          <button
            type="button"
            onClick={start}
            disabled={
              !initialized ||
              practice.status === "ended" ||
              practice.recordingMode === "unavailable"
            }
          >
            {draft ? "重新录音" : "开始录音"}
          </button>
        )}
        {phase === "recording" && (
          <button
            type="button"
            onClick={() => {
              setPhase("stopping");
              recorder.current?.stop();
            }}
          >
            停止录音
          </button>
        )}
        {(phase === "draft" ||
          phase === "recording" ||
          phase === "requesting") &&
          !pending.length && (
            <button type="button" className="secondary" onClick={discard}>
              丢弃录音
            </button>
          )}
        {draft && phase === "draft" && !pending.length && (
          <button type="button" onClick={() => send()}>
            提交本次录音
          </button>
        )}
        {pending.length > 0 && phase !== "sending" && (
          <button
            type="button"
            disabled={!initialized}
            onClick={() => send(true)}
          >
            核对并重发同一次提交
          </button>
        )}
      </div>
      {pending.length > 1 && (
        <p>还有 {pending.length} 次提交待核对，请逐一处理。</p>
      )}
      <h2>本次作答</h2>
      {practice.transcriptionMode === "development" ? (
        <p className="message">
          开发识别替身：下方转写为固定测试文本，不代表真实录音识别结果。
        </p>
      ) : (
        <p>识别服务尚未配置，已接收作答会保留。</p>
      )}
      {attempts.length === 0 ? (
        <p>本次练习还没有作答。</p>
      ) : (
        <ol>
          {attempts.map((item, index) => (
            <li key={item.id}>
              <strong>作答 {index + 1}</strong>
              <TranscriptionReview
                initial={item}
                practiceId={practice.id}
                ended={practice.status === "ended"}
                enabled={practice.transcriptionMode === "development"}
                feedbackEnabled={practice.feedbackMode === "development"}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
