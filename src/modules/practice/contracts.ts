import type { ContentVersion } from "../learning-content/contracts";
export type PracticeId = string;
export type PracticeSummary = {
  id: PracticeId;
  title: string;
  createdAt: string;
  status: "in-progress" | "ended";
};
export type Attempt = {
  id: string;
  submissionId: string;
  acceptedAt: string;
  status: "pending-identification";
};
export type PracticeDetail = PracticeSummary & {
  content: ContentVersion;
  attempts: Attempt[];
  recordingMode: "development" | "unavailable";
};
export class PracticeError extends Error {
  readonly name = "PracticeError";
  constructor(
    public readonly code:
      | "unauthorized"
      | "not-found"
      | "invalid"
      | "conflict"
      | "ended"
      | "recording-invalid"
      | "recording-unavailable",
  ) {
    super(
      {
        unauthorized: "请先验证邮箱并登录。",
        "not-found": "找不到该练习，请返回练习记录。",
        invalid: "请求格式不正确，请重新选择材料。",
        conflict: "请求标识已用于其他材料或录音，请核对已接收记录。",
        ended: "练习已结束，不能再提交录音。",
        "recording-invalid": "录音无效、已不可用或不属于本次练习，请重新录音。",
        "recording-unavailable": "录音存储尚未配置，暂时不能提交。",
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
      error.code === "invalid" ||
      error.code === "conflict" ||
      error.code === "ended" ||
      error.code === "recording-invalid" ||
      error.code === "recording-unavailable")
  );
}
