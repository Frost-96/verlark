import { expect, type APIRequestContext } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";

export async function signIn(request: APIRequestContext, email: string) {
  const password = "listening-password-123";
  const headers = { origin: "http://localhost:3100" };
  const signup = await request.post("/api/auth/sign-up/email", {
    headers,
    data: { email, password, name: "聆听学习者" },
  });
  expect(signup.ok()).toBe(true);
  const messages = await Promise.all(
    (await readdir(".dev-mail")).map(async (file) =>
      JSON.parse(await readFile(`.dev-mail/${file}`, "utf8")),
    ),
  );
  const message = messages.findLast(
    (value) => value.to === email && value.kind === "verification",
  );
  const token = new URL(message.url).searchParams.get("token");
  const verified = await request.get(
    `/api/auth/verify-email?token=${encodeURIComponent(token!)}`,
  );
  expect(verified.ok()).toBe(true);
  const login = await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  });
  expect(login.ok()).toBe(true);
  return login.json();
}
