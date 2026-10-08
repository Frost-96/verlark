import Link from "next/link";
export default function NotFound() {
  return (
    <section>
      <h1>找不到这个页面</h1>
      <p>页面可能已移除，或还未开放。</p>
      <Link href="/">返回首页</Link>
    </section>
  );
}
