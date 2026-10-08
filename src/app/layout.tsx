import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verlark · 先听后用",
  description: "从听见一句英语，到说出自己的想法。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            verlark<span>先听后用</span>
          </Link>
          <nav aria-label="主导航">
            <Link href="/account">我的账号</Link>
            <Link href="/login">登录</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>Verlark · 内部测试阶段 · 学习流程尚未开放</footer>
      </body>
    </html>
  );
}
