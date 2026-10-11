import type { MaterialAudioMetadata } from "../../integrations/material-audio/contracts";
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
  audioPath?: string;
  privateAudio?: MaterialAudioMetadata;
};
export type ContentVersion = Omit<
  ContentSource,
  "audioPath" | "privateAudio"
> & {
  audioPath: string;
  audioProvenance: "reviewed" | "development";
  audioStatus: "available" | "unavailable" | "cleaned";
  id: ContentVersionId;
  available: boolean;
};
export type MaterialSummary = Pick<
  ContentVersion,
  "id" | "materialKey" | "revision" | "title" | "summary"
>;
export class ContentError extends Error {
  readonly name = "ContentError";
  constructor(
    public readonly code: "unavailable" | "immutable" | "invalid" | "withdrawn",
  ) {
    super(
      {
        withdrawn:
          "原内容版本已撤下，不能重练。历史记录仍保留，可返回材料目录另选新版。",
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
    (error.code === "withdrawn" ||
      error.code === "unavailable" ||
      error.code === "immutable" ||
      error.code === "invalid")
  );
}
