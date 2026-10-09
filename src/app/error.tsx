"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section>
      <h1>暂时无法完成操作</h1>
      <p>请稍后重试；若问题持续，请联系维护者。</p>
      <button onClick={reset}>重新加载</button>
    </section>
  );
}
