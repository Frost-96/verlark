"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coffee,
  Headphones,
  History,
  Lightbulb,
  Mic,
  Moon,
  RotateCcw,
  Search,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  materials,
  alternatives,
  statusLabels,
  type Attempt,
  type Material,
  type Practice,
} from "./fixtures";
import {
  PrototypeSwitcher,
  variantNames,
  type Variant,
} from "./prototype-switcher";

type View = "library" | "practice" | "history";
type Draft = "idle" | "recording" | "ready";
type LayoutProps = {
  navigation: ReactNode;
  heading: ReactNode;
  content: ReactNode;
  context: ReactNode;
  view: View;
};
const steps = ["听一段对话", "说说你自己", "核对转写", "看看反馈"];

function Logo() {
  return (
    <span className="proto-logo">
      <Image
        className="logo-light"
        src="/prototype/logo-primary.svg"
        alt="verlark"
        width={176}
        height={48}
        priority
      />
      <Image
        className="logo-dark"
        src="/prototype/logo-white.svg"
        alt="verlark"
        width={176}
        height={48}
        priority
      />
    </span>
  );
}
function Action({
  children,
  onClick,
  quiet = false,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  quiet?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      className={`proto-button ${quiet ? "quiet" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

export function VariantA({
  navigation,
  heading,
  content,
  context,
  view,
}: LayoutProps) {
  return (
    <div className="layout-a">
      <aside className="sidebar">{navigation}</aside>
      <div className="desk">
        {heading}
        <div
          className={`desk-columns ${view === "practice" ? "is-practice" : ""}`}
        >
          <div className="main-content">{content}</div>
          <aside className="context-column">{context}</aside>
        </div>
      </div>
    </div>
  );
}
export function VariantB({
  navigation,
  heading,
  content,
  context,
  view,
}: LayoutProps) {
  return (
    <div className="layout-b">
      <header className="top-navigation">{navigation}</header>
      <div className={`focus-page ${view === "practice" ? "is-practice" : ""}`}>
        {heading}
        <div className="main-content">{content}</div>
        <aside className="focus-context">{context}</aside>
      </div>
    </div>
  );
}
export function VariantC({
  navigation,
  heading,
  content,
  context,
  view,
}: LayoutProps) {
  return (
    <div className="layout-c">
      <header className="top-navigation">{navigation}</header>
      {heading}
      <div
        className={`studio-columns ${view === "practice" ? "is-practice" : ""}`}
      >
        <aside className="studio-context">{context}</aside>
        <div className="main-content">{content}</div>
      </div>
    </div>
  );
}

export function Prototype({ variant }: { variant: Variant }) {
  const [view, setView] = useState<View>("library");
  const [records, setRecords] = useState<Practice[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>("idle");
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("全部主题");
  const [showText, setShowText] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [helpLevel, setHelpLevel] = useState(0);
  const [theme, setTheme] = useState("auto");
  const [inspect, setInspect] = useState(false);
  const [scenario, setScenario] = useState("normal");
  const [modal, setModal] = useState<{
    kind: "leave" | "delete";
    id?: number;
    destination?: View;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [previewId, setPreviewId] = useState("weekend");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const materialAudio = useRef<HTMLAudioElement>(null);
  const current = records.find((r) => r.id === currentId);
  const material =
    materials.find(
      (m) => m.id === (view === "practice" ? current?.materialId : previewId),
    ) ?? materials[0]!;
  const attempt = current?.attempts.find((a) => a.id === selectedAttempt);
  const busy =
    current?.attempts.some(
      (a) => a.status === "transcribing" || a.status === "feedback-pending",
    ) ?? false;
  const canEnd =
    !busy && !!current?.attempts.some((a) => a.feedbackRevision === a.revision);
  const filtered = materials.filter(
    (m) =>
      (topic === "全部主题" || m.topic === topic) &&
      `${m.title}${m.topic}${m.description}`.includes(search),
  );
  const activeRecords = records.filter((r) => !r.ended);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view, currentId, variant]);
  useEffect(() => {
    console.debug("[Verlark prototype state]", {
      variant,
      view,
      step,
      draft,
      currentId,
      selectedAttempt,
      canEnd,
      scenario,
      records,
    });
  }, [
    variant,
    view,
    step,
    draft,
    currentId,
    selectedAttempt,
    canEnd,
    scenario,
    records,
  ]);

  useEffect(() => {
    if (
      !records.some((r) =>
        r.attempts.some(
          (a) => a.status === "transcribing" || a.status === "feedback-pending",
        ),
      )
    )
      return;
    const timer = window.setTimeout(() => {
      setRecords((previous) =>
        previous.map((r) => ({
          ...r,
          attempts: r.attempts.map((a) => {
            if (a.status === "transcribing")
              return {
                ...a,
                status:
                  scenario === "transcript-error"
                    ? ("transcript-error" as const)
                    : ("confirm" as const),
              };
            if (a.status === "feedback-pending")
              return scenario === "feedback-error"
                ? { ...a, status: "feedback-error" as const }
                : {
                    ...a,
                    status: "feedback" as const,
                    feedbackRevision: a.revision,
                  };
            return a;
          }),
        })),
      );
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [records, scenario]);
  useEffect(() => {
    if (draft === "idle") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  const updateAttempt = (changes: Partial<Attempt>) =>
    setRecords((previous) =>
      previous.map((r) =>
        r.id !== currentId || r.ended
          ? r
          : {
              ...r,
              attempts: r.attempts.map((a) =>
                a.id === selectedAttempt ? { ...a, ...changes } : a,
              ),
            },
      ),
    );
  function start(m: Material) {
    const record: Practice = {
      id: Date.now(),
      materialId: m.id,
      ended: false,
      attempts: [],
    };
    setRecords((previous) => [record, ...previous]);
    setCurrentId(record.id);
    setPreviewId(m.id);
    setSelectedAttempt(null);
    setStep(0);
    setDraft("idle");
    setShowText(false);
    setShowTranslation(false);
    setHelpLevel(0);
    setMessage("");
    setView("practice");
  }
  function navigate(destination: View) {
    if (destination === view) return;
    if (draft !== "idle") {
      setModal({ kind: "leave", destination });
      return;
    }
    setView(destination);
    setMessage("");
  }
  function resume(r: Practice) {
    setCurrentId(r.id);
    const latest = r.attempts.at(-1);
    setSelectedAttempt(latest?.id ?? null);
    setText(latest?.text ?? "");
    setDraft("idle");
    setStep(latest ? (latest.status.startsWith("feedback") ? 3 : 2) : 0);
    setShowText(false);
    setShowTranslation(false);
    setHelpLevel(0);
    setMessage("");
    setView("practice");
  }
  function submit() {
    if (!current || current.ended || draft !== "ready") return;
    const id = Date.now();
    const newAttempt: Attempt = {
      id,
      text: material.sample,
      status: "transcribing",
      revision: 1,
      previous: [],
    };
    setRecords((previous) =>
      previous.map((r) =>
        r.id === currentId
          ? { ...r, attempts: [...r.attempts, newAttempt] }
          : r,
      ),
    );
    setSelectedAttempt(id);
    setText(newAttempt.text);
    setDraft("idle");
    setStep(2);
  }
  function feedback() {
    if (!attempt || !text.trim() || current?.ended) return;
    const changed = attempt.text !== text.trim();
    updateAttempt({
      text: text.trim(),
      revision: changed ? attempt.revision + 1 : attempt.revision,
      status: "feedback-pending",
      previous:
        changed && attempt.feedbackRevision
          ? [
              ...attempt.previous,
              { text: attempt.text, revision: attempt.revision },
            ]
          : attempt.previous,
      feedbackRevision: changed ? undefined : attempt.feedbackRevision,
    });
    setStep(3);
  }
  function correct() {
    if (!attempt || current?.ended) return;
    setText(attempt.text);
    setStep(2);
  }
  function endPractice() {
    if (!canEnd) return;
    setRecords((previous) =>
      previous.map((r) => (r.id === currentId ? { ...r, ended: true } : r)),
    );
    setDraft("idle");
    setMessage("本次练习已结束。你可以回看记录，或开启一次新的重练。");
  }

  const navigation = (
    <>
      <Logo />
      <div className="nav-group">
        <button
          className={view === "library" ? "nav-item active" : "nav-item"}
          onClick={() => navigate("library")}
        >
          <BookOpen size={19} />
          练习材料
        </button>
        <button
          className={view === "history" ? "nav-item active" : "nav-item"}
          onClick={() => navigate("history")}
        >
          <History size={19} />
          练习记录
          {records.length > 0 && (
            <span className="nav-count">{records.length}</span>
          )}
        </button>
      </div>
      <div className="sidebar-note">
        <Headphones size={25} />
        <p>
          先听见别人的表达，
          <br />
          再找到自己的说法。
        </p>
        <span>每次留出 5 至 10 分钟</span>
      </div>
      <div className="nav-bottom">
        <button
          className="theme-button"
          aria-label="切换明暗主题"
          onClick={() =>
            setTheme(
              theme === "dark" ||
                (theme === "auto" &&
                  window.matchMedia("(prefers-color-scheme: dark)").matches)
                ? "light"
                : "dark",
            )
          }
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span>外观</span>
        </button>
        <div className="profile">
          <span className="profile-mark">试</span>
          <div>
            体验学习者<small>本地原型</small>
          </div>
        </div>
      </div>
    </>
  );
  const heading = (
    <div className="page-heading">
      <div className="breadcrumb">
        <span>我的学习空间</span>
        <ChevronRight size={13} />
        <span>
          {view === "library"
            ? "练习材料"
            : view === "history"
              ? "练习记录"
              : material.topic}
        </span>
      </div>
      <div className="proto-notice">
        <span>交互原型</span> 示例内容，刷新后重置
      </div>
    </div>
  );

  const materialPlayer = (
    <section className="listening-panel">
      <div className="section-label">
        <Headphones size={17} /> 听力材料
      </div>
      <h2>{material.title}</h2>
      <p className="muted">先听一遍。不必听懂每个词，留意他们怎么表达。</p>
      <div className="audio-box">
        <div className="audio-caption">
          <span>日常短对话</span>
          <small>合成示例音频</small>
        </div>
        <audio
          ref={materialAudio}
          key={material.id}
          controls
          preload="metadata"
          src={`/prototype/audio/${material.id}.wav`}
          aria-label={`${material.title}听力材料`}
          onError={() =>
            setMessage("示例音频暂时无法播放，请重新加载页面后再试。")
          }
        />
      </div>
      <div className="disclosure-group">
        <button
          className="text-disclosure"
          aria-expanded={showText}
          onClick={() => setShowText(!showText)}
        >
          材料原文{" "}
          <ChevronDown size={16} className={showText ? "rotated" : ""} />
        </button>
        {showText && (
          <div className="dialogue" lang="en">
            {material.dialogue.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        <button
          className="text-disclosure"
          aria-expanded={showTranslation}
          onClick={() => setShowTranslation(!showTranslation)}
        >
          中文释义{" "}
          <ChevronDown size={16} className={showTranslation ? "rotated" : ""} />
        </button>
        {showTranslation && (
          <p className="translation">{material.translation}</p>
        )}
      </div>
    </section>
  );
  const help = (
    <section className="help-panel">
      <div className="section-label">
        <Lightbulb size={17} /> 需要一点帮助？
      </div>
      <p>先从关键词开始。想不到怎么说时，再看看完整示例。</p>
      {helpLevel > 0 && (
        <div className="hint-phrases" lang="en">
          {material.hint.split(" / ").map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      )}
      {helpLevel > 1 && (
        <div className="sample-box">
          <small>一种可能的表达</small>
          <p lang="en">{material.sample}</p>
          <small>试着换成你自己的情况。</small>
        </div>
      )}
      <button
        className="inline-link"
        onClick={() => setHelpLevel(helpLevel === 2 ? 0 : helpLevel + 1)}
      >
        {helpLevel === 0
          ? "看看关键词"
          : helpLevel === 1
            ? "看看完整示例"
            : "收起帮助"}
        <ArrowUpRight size={15} />
      </button>
    </section>
  );
  const attemptList = current && current.attempts.length > 0 && (
    <section className="attempt-list">
      <h3>这次练习的作答</h3>
      {current.attempts.map((a, i) => (
        <button
          key={a.id}
          className={
            a.id === selectedAttempt ? "attempt-row selected" : "attempt-row"
          }
          onClick={() => {
            if (draft !== "idle") {
              setMessage("请先试听、提交或丢弃当前录音草稿，再切换作答。");
              return;
            }
            setSelectedAttempt(a.id);
            setText(a.text);
            setStep(a.status.startsWith("feedback") ? 3 : 2);
          }}
        >
          <span>第 {i + 1} 次作答</span>
          <small>{statusLabels[a.status]}</small>
          <ChevronRight size={14} />
        </button>
      ))}
    </section>
  );
  const context =
    view === "practice" ? (
      <>
        {variant === "C" ? (
          materialPlayer
        ) : (
          <div className="practice-summary">
            <Image
              src="/prototype/weekend-cafe.png"
              alt="阳光下的咖啡馆，桌上放着咖啡和书"
              width={420}
              height={260}
            />
            <div className="section-label">{material.topic}</div>
            <h3>{material.title}</h3>
            <p>听过以后，用自己的经历回答。</p>
          </div>
        )}
        {help}
        {attemptList}
        <p className="privacy-note">
          仅在当前页面内存中演示。模拟录音不会启用麦克风，也不会上传文件。
        </p>
      </>
    ) : view === "history" ? (
      <div className="side-editorial">
        <History size={27} />
        <h2>
          每次尝试，
          <br />
          都可以回来看看。
        </h2>
        <p>同一练习里可以多次作答。结束以后重练，会开启一份新的记录。</p>
        <p className="muted">完成练习不等于已经掌握表达。</p>
      </div>
    ) : (
      <>
        <div className="side-editorial">
          <span className="small-label">从听到说</span>
          <h2>
            不用准备好，
            <br />
            也可以开始。
          </h2>
          <p>
            听一小段，借用一个表达，
            <br />
            说一件自己的事。
          </p>
          <ol className="learning-path">
            <li>
              <Headphones size={17} />
              <div>
                先听一听<small>熟悉真实交流的说法</small>
              </div>
            </li>
            <li>
              <Mic size={17} />
              <div>
                换成你的故事<small>围绕任务，表达自己的想法</small>
              </div>
            </li>
            <li>
              <BookOpen size={17} />
              <div>
                带着反馈再试一次<small>只关注影响理解的重点</small>
              </div>
            </li>
          </ol>
        </div>
        <section className="continue-section">
          <div className="section-heading">
            <h3>继续上次练习</h3>
            <History size={17} />
          </div>
          {activeRecords.length ? (
            activeRecords.slice(0, 2).map((r) => (
              <button
                className="continue-link"
                key={r.id}
                onClick={() => resume(r)}
              >
                <span>
                  {materials.find((m) => m.id === r.materialId)?.title}
                  <small>{r.attempts.length} 次作答 · 未结束</small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))
          ) : (
            <p className="muted">
              还没有未结束的练习。
              <br />
              选一个想聊的话题吧。
            </p>
          )}
        </section>
      </>
    );

  const library = (
    <>
      <div className="section-intro">
        <p className="small-label">把英语用在生活里</p>
        <h1>今天，想聊点什么？</h1>
        <p>从一段短对话开始，把听到的表达变成自己的话。</p>
      </div>
      {variant !== "C" && (
        <section className="featured-material">
          <div className="feature-copy">
            <span className="material-tag">周末计划</span>
            <h2>
              给周末，
              <br />
              留一点自己的时间。
            </h2>
            <p>
              去咖啡馆，读一本书，或是什么都不安排。
              <br className="desktop-break" />
              听完他们的计划，说说你的。
            </p>
            <div className="feature-meta">
              <Headphones size={15} /> 短对话 <span /> <Clock3 size={15} /> 约 5
              至 10 分钟
            </div>
            <Action onClick={() => start(materials[0]!)}>
              开始练习 <ArrowRight size={17} />
            </Action>
          </div>
          <div className="feature-image">
            <Image
              src="/prototype/weekend-cafe.png"
              alt="安静的咖啡馆，两张红橙色椅子围着放有咖啡和书的小桌"
              fill
              sizes="(max-width: 767px) 100vw, 40vw"
              priority
            />
          </div>
        </section>
      )}
      <div className="material-toolbar">
        <h2>找一个熟悉的话题</h2>
        <label className="search-box">
          <Search size={16} />
          <span className="sr-only">搜索练习材料</span>
          <input
            placeholder="搜索话题"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label="清空搜索" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div className="topic-filter" aria-label="按主题筛选">
        {["全部主题", "周末计划", "介绍自己", "表达喜好"].map((t) => (
          <button
            aria-pressed={topic === t}
            onClick={() => setTopic(t)}
            key={t}
          >
            {t}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <Search size={30} />
          <h3>还没有这个话题</h3>
          <p>换个关键词，或回到全部主题。</p>
          <Action
            quiet
            onClick={() => {
              setSearch("");
              setTopic("全部主题");
            }}
          >
            查看全部材料
          </Action>
        </div>
      ) : (
        <div className="catalog-grid">
          {filtered.map((m, i) => (
            <button
              className={`material-item ${previewId === m.id ? "chosen" : ""}`}
              key={m.id}
              onClick={() => (variant === "C" ? setPreviewId(m.id) : start(m))}
            >
              <span className={`topic-icon tint-${i % 3}`}>
                {m.id === "weekend" ? (
                  <Coffee size={22} />
                ) : m.id === "introduce" ? (
                  <Mic size={22} />
                ) : (
                  <BookOpen size={22} />
                )}
              </span>
              <span className="material-item-copy">
                <small>{m.topic}</small>
                <h3>{m.title}</h3>
                <p>{m.description}</p>
              </span>
              <ArrowUpRight className="material-arrow" size={18} />
            </button>
          ))}
        </div>
      )}
      {variant === "C" && (
        <section className="selected-preview">
          <Image
            src="/prototype/weekend-cafe.png"
            alt="作为场景示意的咖啡馆"
            width={700}
            height={360}
          />
          <div>
            <span className="material-tag">{material.topic}</span>
            <h2>{material.title}</h2>
            <p>{material.task}</p>
            <Action onClick={() => start(material)}>
              开始练习 <ArrowRight size={17} />
            </Action>
          </div>
        </section>
      )}
      <p className="content-footnote">
        6 个主题为原型示例，正式材料需经内容检查后发布。
      </p>
    </>
  );

  const history = (
    <>
      <div className="section-intro">
        <p className="small-label">留下每一次尝试</p>
        <h1>练习记录</h1>
        <p>回看自己的表达，或接着上一次继续。</p>
      </div>
      {!records.length ? (
        <div className="empty-state history-empty">
          <BookOpen size={38} />
          <h2>你的第一段表达，从这里开始。</h2>
          <p>
            提交后的作答会出现在练习里。
            <br />
            还没说完也没关系，下次可以继续。
          </p>
          <Action onClick={() => setView("library")}>
            选择练习材料 <ArrowRight size={16} />
          </Action>
        </div>
      ) : (
        <div className="history-list">
          {records.map((r) => {
            const m = materials.find((item) => item.id === r.materialId)!;
            return (
              <article className="history-item" key={r.id}>
                <div className="history-icon">
                  <Headphones size={22} />
                </div>
                <div className="history-description">
                  <span className="material-tag">
                    {r.ended ? "已结束" : "未结束"}
                  </span>
                  <h2>{m.title}</h2>
                  <p>{r.attempts.length} 次作答 · 内容版本 1（示例）</p>
                  <div className="history-statuses">
                    {r.attempts.map((a, i) => (
                      <small key={a.id}>
                        作答 {i + 1}：{statusLabels[a.status]}
                      </small>
                    ))}
                  </div>
                </div>
                <div className="history-actions">
                  <Action quiet onClick={() => resume(r)}>
                    {r.ended ? "查看记录" : "继续练习"}
                    <ArrowRight size={15} />
                  </Action>
                  {r.ended && (
                    <button className="inline-link" onClick={() => start(m)}>
                      <RotateCcw size={14} />
                      重练
                    </button>
                  )}
                  <button
                    className="delete-button"
                    aria-label={`删除${m.title}练习`}
                    onClick={() => setModal({ kind: "delete", id: r.id })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );

  const pending = (
    <div className="pending-panel" role="status">
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
      <div className="skeleton-line" />
      <p>
        {attempt?.status === "transcribing"
          ? "作答已接收，正在识别示例录音…"
          : "正在为确认文本准备示例反馈…"}
      </p>
      <small>模拟处理，不调用真实服务。</small>
    </div>
  );
  const feedbackPanel = attempt && (
    <section className="feedback-panel">
      <div className="feedback-verdict">
        <span className="feedback-check">
          <Check size={23} />
        </span>
        <div>
          <p className="small-label">表达反馈</p>
          <h2>你的意思表达清楚了。</h2>
          <p>示例回答交代了计划，也说明了原因。没有需要纠正的问题。</p>
        </div>
      </div>
      <div className="feedback-scope">
        以下是固定示例反馈，用于预览结构，不是对输入文本的真实分析。仅基于确认文本，不评价发音、语调或停顿。
      </div>
      <div className="confirmed-block">
        <div className="section-heading">
          <h3>你的确认文本</h3>
          <span>第 {attempt.revision} 版</span>
        </div>
        <p lang="en">{attempt.text}</p>
        {!current?.ended && (
          <button className="inline-link" onClick={correct}>
            有识别错误？更正文本 <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      <div className="alternative">
        <Lightbulb size={20} />
        <div>
          <h3>也可以这样说</h3>
          <p lang="en">{alternatives[material.id]}</p>
          <small>这是一种可选表达，并不意味着原话有错。</small>
        </div>
      </div>
      {attempt.previous.length > 0 && (
        <details className="old-feedback">
          <summary>查看旧文本对应的反馈（{attempt.previous.length}）</summary>
          {attempt.previous.map((p, i) => (
            <div key={i}>
              <small>第 {p.revision} 版 · 历史反馈，不是当前有效反馈</small>
              <p lang="en">{p.text}</p>
              <p>固定示例：意思表达清楚，没有需要纠正的问题。</p>
            </div>
          ))}
        </details>
      )}
      {!current?.ended && (
        <div className="panel-actions">
          <Action
            onClick={() => {
              setDraft("idle");
              setSelectedAttempt(null);
              setStep(1);
            }}
          >
            再次作答 <Mic size={16} />
          </Action>
          <Action quiet disabled={!canEnd} onClick={endPractice}>
            结束练习 <Check size={16} />
          </Action>
        </div>
      )}
    </section>
  );
  const practice = current && (
    <>
      <button className="back-link" onClick={() => navigate("library")}>
        <ArrowLeft size={15} />
        练习材料
      </button>
      <div className="practice-heading">
        <div>
          <p className="small-label">
            {current.ended ? "已结束的练习" : "先听后用"}
          </p>
          <h1>{material.title}</h1>
        </div>
        <span className="practice-count">{current.attempts.length} 次作答</span>
      </div>
      <nav className="step-nav" aria-label="练习进度">
        {steps.map((s, i) => (
          <button
            key={s}
            aria-current={step === i ? "step" : undefined}
            disabled={
              (i === 1 && current.ended) ||
              (i >= 2 &&
                (!attempt ||
                  (i === 3 && !attempt.status.startsWith("feedback"))))
            }
            onClick={() => {
              if (draft !== "idle" && i !== 1) {
                setMessage("请先提交或丢弃当前录音草稿。");
                return;
              }
              setStep(i);
            }}
          >
            <span>{i + 1}</span>
            {s}
          </button>
        ))}
      </nav>
      {current.ended && (
        <div className="ended-banner">
          <Check size={18} />
          <span>练习已结束，记录只读。结束不代表已掌握。</span>
          <button onClick={() => start(material)}>
            重练 <RotateCcw size={15} />
          </button>
        </div>
      )}
      {step === 0 && (
        <>
          {variant === "C" ? (
            <section className="task-panel">
              <span className="section-label">听完之后，聊聊这件事</span>
              <h2>{material.task}</h2>
              <p>留意对话里介绍计划和原因的表达。</p>
            </section>
          ) : (
            materialPlayer
          )}
          <div className="listen-next">
            <p>
              <Lightbulb size={17} /> 不用背下来，能借用一个表达就可以。
            </p>
            {!current.ended && (
              <Action
                onClick={() => {
                  materialAudio.current?.pause();
                  setStep(1);
                }}
              >
                我来试着说说 <ArrowRight size={16} />
              </Action>
            )}
          </div>
        </>
      )}
      {step === 1 && (
        <section className="speaking-panel">
          <span className="section-label">表达任务</span>
          <h2>{material.task}</h2>
          <p className="muted">不需要复述材料，用英语说说真实的你。</p>
          <div className={`recorder ${draft}`}>
            <span className="recorder-icon">
              {draft === "recording" ? <Square size={26} /> : <Mic size={30} />}
            </span>
            <h3>
              {draft === "idle"
                ? "按自己的节奏，试着说一说。"
                : draft === "recording"
                  ? "正在模拟录音"
                  : "先听听，再决定要不要提交。"}
            </h3>
            <p>
              {draft === "idle"
                ? "这是交互演示，不会开启麦克风。"
                : draft === "recording"
                  ? "点击停止，预览录音草稿状态。"
                  : "试听使用预设示例音频，并非你的实际录音。"}
            </p>
            {draft === "ready" && (
              <audio
                controls
                src={`/prototype/audio/${material.id}-attempt.wav`}
                aria-label="试听示例录音"
              />
            )}
            <div className="recorder-actions">
              {draft === "idle" && (
                <Action onClick={() => setDraft("recording")}>
                  <Mic size={17} />
                  模拟录音
                </Action>
              )}
              {draft === "recording" && (
                <Action onClick={() => setDraft("ready")}>
                  <Square size={15} />
                  停止录音
                </Action>
              )}
              {draft === "ready" && (
                <>
                  <Action onClick={submit}>
                    提交作答 <ArrowRight size={16} />
                  </Action>
                  <Action quiet onClick={() => setDraft("idle")}>
                    <RotateCcw size={15} />
                    丢弃并重录
                  </Action>
                </>
              )}
            </div>
          </div>
          <p className="draft-note">
            只有提交被接收才算一次作答。未提交的录音离开后可能丢失。
          </p>
        </section>
      )}
      {step === 2 && attempt && (
        <section className="transcript-panel">
          <span className="section-label">核对转写</span>
          <h2>这还原了你刚才说的话吗？</h2>
          <p className="muted">
            这里只纠正识别错误。想换一种说法，请再次作答。
          </p>
          {attempt.status === "transcribing" ? (
            pending
          ) : attempt.status === "transcript-error" ? (
            <div className="inline-error" role="alert">
              <h3>这次没能识别出文字</h3>
              <p>已接收的作答仍然保留。重新识别会处理同一份录音。</p>
              {!current.ended && (
                <Action
                  quiet
                  onClick={() => {
                    setScenario("normal");
                    updateAttempt({ status: "transcribing" });
                  }}
                >
                  重新识别
                </Action>
              )}
            </div>
          ) : (
            <>
              <label className="transcript-label" htmlFor="confirmed-text">
                {current.ended ? "确认文本" : "识别转写（可纠正）"}
              </label>
              <textarea
                id="confirmed-text"
                lang="en"
                value={text}
                readOnly={current.ended}
                onChange={(e) => setText(e.target.value)}
                rows={5}
              />
              <small className="field-help">
                此处预填示例文本，不来自真实语音识别。
              </small>
              {!text.trim() && (
                <p className="field-error">
                  确认文本不能为空，请还原你实际说出的内容。
                </p>
              )}
              {!current.ended && (
                <div className="panel-actions">
                  <Action disabled={!text.trim()} onClick={feedback}>
                    确认文本，查看反馈 <ArrowRight size={16} />
                  </Action>
                </div>
              )}
              {attempt.previous.length > 0 && (
                <p className="revision-note">
                  旧反馈已保留，需为这版确认文本重新生成反馈。
                </p>
              )}
            </>
          )}
        </section>
      )}
      {step === 3 &&
        attempt &&
        (attempt.status === "feedback-pending" ? (
          pending
        ) : attempt.status === "feedback-error" ? (
          <div className="inline-error" role="alert">
            <h2>反馈暂时没能生成</h2>
            <p>确认文本已保留。这是处理失败，不是对表达能力的评价。</p>
            {!current.ended && (
              <Action
                quiet
                onClick={() => {
                  setScenario("normal");
                  updateAttempt({ status: "feedback-pending" });
                }}
              >
                重新生成反馈
              </Action>
            )}
          </div>
        ) : (
          feedbackPanel
        ))}
      {!current.ended && (step !== 3 || attempt?.status !== "feedback") && (
        <div className="practice-bottom">
          <span>
            {busy
              ? "请等待当前处理完成"
              : canEnd
                ? "已有当前有效反馈，可以结束本次练习。"
                : "至少一份当前有效反馈后，可以结束练习。"}
          </span>
          <button disabled={!canEnd || draft !== "idle"} onClick={endPractice}>
            结束练习
          </button>
        </div>
      )}
      {current.ended && (
        <div className="panel-actions">
          <Action quiet onClick={() => navigate("history")}>
            返回练习记录 <ArrowRight size={16} />
          </Action>
        </div>
      )}
    </>
  );

  const layoutProps: LayoutProps = {
    navigation,
    heading,
    content:
      view === "library" ? library : view === "history" ? history : practice,
    context,
    view,
  };
  return (
    <div
      ref={setRoot}
      className="prototype-root"
      data-theme={theme}
      data-variant={variant}
    >
      <a className="skip-link" href="#prototype-content">
        跳到主要内容
      </a>
      <div id="prototype-content">
        {variant === "A" ? (
          <VariantA {...layoutProps} />
        ) : variant === "B" ? (
          <VariantB {...layoutProps} />
        ) : (
          <VariantC {...layoutProps} />
        )}
      </div>
      {message && (
        <div className="proto-toast" role="status">
          {message}
          <button aria-label="关闭提示" onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <PrototypeSwitcher
        variant={variant}
        onInspect={() => setInspect(!inspect)}
      />
      {inspect && (
        <section className="state-inspector" aria-label="原型状态">
          <div className="section-heading">
            <h3>原型状态 · {variantNames[variant]}</h3>
            <button aria-label="关闭原型状态" onClick={() => setInspect(false)}>
              <X size={17} />
            </button>
          </div>
          <p>所有内容为本地示例。切换方案保留状态，刷新会清空。</p>
          <label htmlFor="scenario">
            下一次模拟处理
            <select
              id="scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            >
              <option value="normal">正常完成</option>
              <option value="transcript-error">识别失败</option>
              <option value="feedback-error">反馈失败</option>
            </select>
          </label>
          <pre>
            {JSON.stringify(
              {
                variant,
                view,
                step: steps[step],
                draft,
                currentId,
                selectedAttempt,
                canEnd,
                scenario,
                records,
              },
              null,
              2,
            )}
          </pre>
        </section>
      )}
      <Dialog.Root
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <Dialog.Portal container={root}>
          <Dialog.Overlay className="proto-modal-overlay" />
          <Dialog.Content className="proto-modal">
            <Dialog.Title>
              {modal?.kind === "delete"
                ? "删除这次练习？"
                : "离开前，丢弃录音草稿？"}
            </Dialog.Title>
            <Dialog.Description>
              {modal?.kind === "delete"
                ? "将移除本地示例练习及其作答和反馈。原型没有上传音频文件。"
                : "未提交的录音不会进入作答记录。练习仍保留为未结束，可从记录里继续。"}
            </Dialog.Description>
            <div className="modal-actions">
              <Action quiet onClick={() => setModal(null)}>
                取消
              </Action>
              <Action
                onClick={() => {
                  if (modal?.kind === "delete") {
                    setRecords((previous) =>
                      previous.filter((r) => r.id !== modal.id),
                    );
                  } else {
                    setDraft("idle");
                    setView(modal?.destination ?? "library");
                  }
                  setModal(null);
                }}
              >
                {modal?.kind === "delete" ? "删除练习" : "丢弃并离开"}
              </Action>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
