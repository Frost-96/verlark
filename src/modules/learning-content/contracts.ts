export type ContentVersionId = string;
export type ContentSource = {
  materialKey: string;
  revision: number;
  title: string;
  summary: string;
  materialText: string;
  translation: string;
  task: string;
  keywords: string[];
  sentenceStarters: string[];
  example: string;
  audioPath: string;
};
export type ContentVersion = ContentSource & { id: ContentVersionId };
export type MaterialSummary = Pick<
  ContentVersion,
  "id" | "materialKey" | "revision" | "title" | "summary"
>;
export class ContentError extends Error {
  readonly name = "ContentError";
  constructor(public readonly code: "unavailable" | "immutable" | "invalid") {
    super(
      {
        unavailable: "材料暂不可用，请返回材料列表重新选择。",
        immutable: "已发布版本不能改写，请增加版本号。",
        invalid: "材料内容不完整或格式不正确。",
      }[code],
    );
  }
}
export function isContentError(error: unknown): error is ContentError {
  return (
    error instanceof Error &&
    error.name === "ContentError" &&
    "code" in error &&
    (error.code === "unavailable" ||
      error.code === "immutable" ||
      error.code === "invalid")
  );
}
