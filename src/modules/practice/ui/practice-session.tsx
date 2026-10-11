"use client";
import { useState, type ReactNode } from "react";
import type { PracticeDetail } from "../contracts";
import { FinishPractice } from "./finish-practice";
import { Recording } from "./recording";

export function PracticeSession({
  initial,
  children,
}: {
  initial: PracticeDetail;
  children: ReactNode;
}) {
  const [practice, setPractice] = useState(initial);
  return (
    <>
      <p>
        {practice.status === "ended" ? "已结束" : "未结束"} · 内容版本{" "}
        {practice.content.revision}
      </p>
      <FinishPractice
        id={practice.id}
        ended={practice.status === "ended"}
        onEnded={setPractice}
      />
      {children}
      {/* Ending releases draft recording resources and shows the authoritative final attempts. */}
      <Recording
        key={`${practice.id}:${practice.status}`}
        practice={practice}
      />
    </>
  );
}
