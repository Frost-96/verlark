import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { PracticeDetail } from "../contracts";
import { Recording } from "./recording";

test("私有录音界面说明真实保留规则与 8 MiB 上限，不再误报未配置", () => {
  const practice: PracticeDetail = {
    id: crypto.randomUUID(),
    title: "周末",
    createdAt: new Date().toISOString(),
    status: "in-progress",
    attempts: [],
    recordingMode: "private",
    content: {
      id: crypto.randomUUID(),
      materialKey: "weekend",
      revision: 1,
      title: "周末",
      summary: "计划",
      materialText: "Any plans?",
      translation: "有什么计划？",
      task: "说说计划。",
      keywords: ["plan"],
      sentenceStarters: ["I will …"],
      example: "I will read.",
      audioPath: "/audio/weekend.wav",
      audioProvenance: "reviewed",
      audioStatus: "available",
      available: true,
    },
  };
  const html = renderToStaticMarkup(createElement(Recording, { practice }));
  expect(html).toContain("录音采用私有存储，接收后保留 30 天");
  expect(html).toContain("120 秒、8 MiB");
  expect(html).not.toContain("录音存储尚未配置");
  expect(html).not.toContain("12 MB");
});
