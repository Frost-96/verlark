"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, SlidersHorizontal } from "lucide-react";
export const variants = ["A", "B", "C", "D", "E"] as const;
export type Variant = (typeof variants)[number];
export const variantNames = {
  A: "练习书桌",
  B: "专注练习",
  C: "听说对照",
  D: "情境电台",
  E: "练习手册",
};
export function PrototypeSwitcher({
  variant,
  onInspect,
}: {
  variant: Variant;
  onInspect: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (target instanceof HTMLElement &&
          target.closest(
            'input, textarea, select, button, audio, [contenteditable="true"], [role="slider"], [role="tablist"]',
          ))
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next =
        variants[
          (variants.indexOf(variant) +
            (event.key === "ArrowRight" ? 1 : -1) +
            variants.length) %
            variants.length
        ]!;
      const query = new URLSearchParams(params.toString());
      query.set("variant", next);
      router.replace(`/prototype?${query}`, { scroll: false });
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [params, router, variant]);
  if (process.env.NODE_ENV === "production") return null;
  const cycle = (direction: number) => {
    const query = new URLSearchParams(params.toString());
    query.set(
      "variant",
      variants[
        (variants.indexOf(variant) + direction + variants.length) %
          variants.length
      ]!,
    );
    router.replace(`/prototype?${query}`, { scroll: false });
  };
  return (
    <div className="prototype-switcher" aria-label="原型方案切换">
      <span className="switcher-caption">设计原型</span>
      <button aria-label="上一个方案" onClick={() => cycle(-1)}>
        <ArrowLeft size={16} />
      </button>
      <span aria-live="polite">
        <b>{variant}</b> {variantNames[variant]}
      </span>
      <button aria-label="下一个方案" onClick={() => cycle(1)}>
        <ArrowRight size={16} />
      </button>
      <span className="switcher-divider" />
      <button aria-label="查看原型状态" onClick={onInspect}>
        <SlidersHorizontal size={16} />
      </button>
    </div>
  );
}
