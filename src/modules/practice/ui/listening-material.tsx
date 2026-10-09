"use client";
import { useRef, useState } from "react";
import type { ContentVersion } from "../../learning-content/contracts";

export function ListeningMaterial({ content }: { content: ContentVersion }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  async function replay() {
    if (!audio.current) return;
    audio.current.currentTime = 0;
    try {
      await audio.current.play();
      setError("");
    } catch {
      setError("暂时无法播放，请检查网络或重新加载音频。");
    }
  }
  return (
    <>
      <section aria-labelledby="listen-heading">
        <h2 id="listen-heading">先听一遍</h2>
        <p>先试着听懂，再按需要查看下方帮助。</p>
        <audio
          key={retry}
          ref={audio}
          controls
          preload="metadata"
          src={content.audioPath}
          aria-label="听力材料播放器"
          onError={() => setError("音频未能加载，请检查网络后重试。")}
        />
        <div className="actions">
          <button type="button" className="secondary" onClick={replay}>
            从头重听
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            重新加载音频
          </button>
        </div>
        {error && (
          <p role="alert" className="message error">
            {error}
          </p>
        )}
        <p className="eyebrow">开发合成音频 · 最终教学录音仍待验证</p>
      </section>
      <section aria-labelledby="help-heading">
        <h2 id="help-heading">按需帮助</h2>
        <details>
          <summary>查看材料原文</summary>
          <p className="material-text" lang="en">
            {content.materialText}
          </p>
        </details>
        <details>
          <summary>查看中文释义</summary>
          <p className="material-text">{content.translation}</p>
        </details>
        <details>
          <summary>查看关键词与句式</summary>
          <ul>
            {content.keywords.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          <ul lang="en">
            {content.sentenceStarters.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          <details>
            <summary>还需要帮助，查看完整示例</summary>
            <p>仅供参考，请表达自己的情况。</p>
            <p lang="en">{content.example}</p>
          </details>
        </details>
      </section>
      <section aria-labelledby="task-heading">
        <h2 id="task-heading">试着表达自己的情况</h2>
        <p>{content.task}</p>
        <p className="notice">
          当前阶段支持聆听和查看帮助，尚未开放录音提交与反馈；本次练习还没有作答。离开后可从练习记录继续。
        </p>
      </section>
    </>
  );
}
