import Link from "next/link";
export default function Home() {
  return (
    <section className="intro">
      <p className="eyebrow">英语交流，从日常开始</p>
      <h1>
        先听懂，
        <br />
        再说出自己的想法。
      </h1>
      <p className="lead">聆听一段日常对话，借助其中的表达，说说你的生活。</p>
      <aside className="notice">
        <strong>先从聆听一段日常对话开始。</strong>
        <p>
          测试名单内的学习者可登录后选择已发布材料、查看帮助并保存练习。口头作答和表达反馈尚未开放。
        </p>
      </aside>
      <div className="actions">
        <Link className="button" href="/signup">
          注册测试账号
        </Link>
        <Link className="button secondary" href="/login">
          已有账号，去登录
        </Link>
      </div>
    </section>
  );
}
