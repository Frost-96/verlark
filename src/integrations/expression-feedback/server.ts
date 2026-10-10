import type { ExpressionFeedback } from "./contracts";
/** Fixed, visibly labelled examples only. Unsupported text never receives invented assessment. */
export function createExpressionFeedback(options: {
  development: boolean;
}): ExpressionFeedback {
  if (!options.development)
    return {
      mode: "unavailable",
      async generate() {
        throw new Error("反馈服务尚未配置。");
      },
    };
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test")
    throw new Error("正式环境或未指定环境禁止开发反馈替身。");
  return {
    mode: "development",
    async generate({ text }) {
      const provenance = {
        provider: "development-fixture",
        model: "fixed-samples-v1",
      };
      if (
        text === "I will read tomorrow." ||
        text === "I will read a book this weekend."
      )
        return {
          kind: "generated",
          summary: "这句话清楚表达了你的阅读计划，没有需要纠正的问题。",
          issues: [],
          alternatives: text.includes("weekend")
            ? [
                {
                  original: text,
                  improved: "I'm planning to read a book this weekend.",
                  explanation:
                    "原话不是错误。这是另一种表达计划的方式，可按语境选择。",
                },
              ]
            : [],
          provenance,
        };
      if (text === "I borrow you my book tomorrow.")
        return {
          kind: "generated",
          summary: "主要需要说清楚谁把书借给谁。",
          issues: [
            {
              original: "I borrow you my book tomorrow.",
              improved: "I'll lend you my book tomorrow.",
              explanation:
                "borrow 表示向别人借入；如果你要把自己的书借给对方，用 lend 能明确借出的方向。",
            },
          ],
          alternatives: [],
          provenance,
        };
      if (text === "I went tomorrow. I borrow you my book.")
        return {
          kind: "generated",
          summary: "时间和借书方向会影响理解，可以先澄清这两处。",
          issues: [
            {
              original: "I went tomorrow.",
              improved: "I'll go tomorrow.",
              explanation:
                "went 表示过去，tomorrow 表示将来，两者让时间不明确。如果指明天去，可以这样说。",
            },
            {
              original: "I borrow you my book.",
              improved: "I'll lend you my book.",
              explanation:
                "如果想把自己的书借给对方，用 lend 表达借出，避免把借入和借出混淆。",
            },
          ],
          alternatives: [],
          provenance,
        };
      return { kind: "failed" };
    },
  };
}
