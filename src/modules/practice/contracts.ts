import type { ContentVersion } from "../learning-content/contracts";
export type PracticeId = string;
export type PracticeSummary = {
  id: PracticeId;
  title: string;
  createdAt: string;
  status: "in-progress" | "ended";
};
export type PracticeDetail = PracticeSummary & { content: ContentVersion };
export class PracticeError extends Error {
  readonly name = "PracticeError";
  constructor(public readonly code: "unauthorized" | "not-found" | "invalid") {
    super(
      {
        unauthorized: "请先验证邮箱并登录。",
        "not-found": "找不到该练习，请返回练习记录。",
        invalid: "请求格式不正确，请重新选择材料。",
      }[code],
    );
  }
}

// Next.js route bundles can load distinct class constructors while sharing services.
export function isPracticeError(error: unknown): error is PracticeError {
  return (
    error instanceof Error &&
    error.name === "PracticeError" &&
    "code" in error &&
    (error.code === "unauthorized" ||
      error.code === "not-found" ||
      error.code === "invalid")
  );
}
