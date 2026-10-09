import type { Metadata } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { Prototype } from "./prototype";
import "./prototype.css";

const manrope = localFont({
  src: "./fonts/Manrope-Variable.ttf",
  display: "swap",
  variable: "--font-prototype",
});
export const metadata: Metadata = {
  title: "verlark | 听说练习原型",
  robots: { index: false, follow: false },
};

// Throwaway UI: compare five learning layouts at /prototype?variant=A|B|C|D|E.
export default async function PrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { variant } = await searchParams;
  return (
    <div className={manrope.variable}>
      <Prototype
        variant={
          variant === "B" ||
          variant === "C" ||
          variant === "D" ||
          variant === "E"
            ? variant
            : "A"
        }
      />
    </div>
  );
}
