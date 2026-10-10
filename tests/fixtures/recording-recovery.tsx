import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Recording } from "../../src/modules/practice/ui/recording";

// Exercise the shipped UI with React's development effect replay, independently
// of whether a particular Next navigation chooses to replay its effects.
async function mount() {
  const id = new URL(location.href).searchParams.get("practice");
  const response = await fetch(`/api/practices/${id}`);
  const practice = await response.json();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Recording practice={practice} />
    </StrictMode>,
  );
}
void mount();
