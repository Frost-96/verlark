import type { ContentVersion } from "../learning-content/contracts";
export type PracticeId = string;
export type PracticeSummary = {
  id: PracticeId;
  title: string;
  createdAt: string;
  status: "in-progress" | "ended";
};
export type FeedbackResult = {
  summary: string;
  issues: { original: string; explanation: string; improved: string }[];
  alternatives: { original: string; explanation: string; improved: string }[];
};
export type Feedback = {
  confirmationId: string;
  status: "processing" | "succeeded" | "failed" | "unknown" | "no-content";
  rulesVersion: string;
  requestId: string;
  leaseExpiresAt: string | null;
  failure: string | null;
  result: FeedbackResult | null;
  provenance: { provider: string; model: string } | null;
  generatedAt: string | null;
};
export type Attempt = {
  feedback: Feedback[];
  id: string;
  submissionId: string;
  acceptedAt: string;
  status:
    | "pending-identification"
    | "processing"
    | "recognized"
    | "failed"
    | "unknown"
    | "no-content";
  failure: string | null;
  leaseExpiresAt: string | null;
  rawTranscript: { id: string; text: string } | null;
  confirmations: {
    id: string;
    revision: number;
    text: string;
    rawTranscriptId: string;
    confirmedAt: string;
  }[];
};
export type PracticeDetail = PracticeSummary & {
  content: ContentVersion;
  attempts: Attempt[];
  feedbackMode?: "development" | "unavailable";
  transcriptionMode?: "development" | "unavailable";
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
      | "recording-unavailable"
      | "processing"
      | "stale"
      | "transcription-unavailable"
      | "feedback-unavailable",
  ) {
    super(
      {
        unauthorized: "请先验证邮箱并登录。",
        "not-found": "找不到该练习，请返回练习记录。",
        invalid: "请求格式不正确，请重新选择材料。",
        conflict: "请求标识已用于其他材料或录音，请核对已接收记录。",
        ended: "练习已结束，不能再提交录音或修改作答。",
        processing: "请求仍在处理中，请稍后查询；超时后可恢复处理状态。",
        stale: "作答状态或确认文本已改变，请重新加载后核对。",
        "feedback-unavailable": "反馈服务尚未配置，暂时不能生成反馈。",
        "transcription-unavailable": "识别服务尚未配置，暂时不能识别。",
        "recording-invalid": "录音无效、已不可用或不属于本次练习，请重新录音。",
        "recording-unavailable": "录音存储尚未配置，暂时不能提交。",
      }[code],
    );
  }
}

export function isPracticeErrorCode(
  code: unknown,
): code is PracticeError["code"] {
  return (
    code === "unauthorized" ||
    code === "not-found" ||
    code === "invalid" ||
    code === "conflict" ||
    code === "ended" ||
    code === "recording-invalid" ||
    code === "recording-unavailable" ||
    code === "processing" ||
    code === "stale" ||
    code === "feedback-unavailable" ||
    code === "transcription-unavailable"
  );
}

// Next.js route bundles can load distinct class constructors while sharing services.
export function isPracticeError(error: unknown): error is PracticeError {
  return (
    error instanceof Error &&
    error.name === "PracticeError" &&
    "code" in error &&
    isPracticeErrorCode(error.code)
  );
}
