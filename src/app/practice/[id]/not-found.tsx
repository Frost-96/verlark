import Link from "next/link";
export default function MissingPractice() {
  return (
    <section>
      <h1>找不到该练习</h1>
      <p>练习不存在或当前账号无法访问。</p>
      <Link href="/practices">返回练习记录</Link>
    </section>
  );
}
