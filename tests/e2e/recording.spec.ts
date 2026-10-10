import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";
async function record(page: Page) {
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByText("正在录音", { exact: false })).toBeVisible();
  // Let the actual browser MediaRecorder produce nonempty audio from its fake device.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await expect(page.getByLabel("录音草稿试听")).toBeVisible();
}
test("录音试听、丢弃重录与响应丢失后重新进入，保持一次已接收作答", async ({
  page,
}, info) => {
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-recording-${info.project.name}@example.com`,
  );
  await page.goto("/materials");
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const practiceURL = page.url();
  const id = practiceURL.split("/").at(-1)!;
  await expect(page.getByText("开发录音文件", { exact: false })).toBeVisible();
  for (const name of ["NotAllowedError", "NotReadableError"]) {
    await page.evaluate((name) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          throw new DOMException("test capture failure", name);
        },
      });
    }, name);
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      name === "NotAllowedError" ? "麦克风权限被拒绝" : "无法采集录音",
    );
  }
  await page.reload();
  // A cancelled permission request may reject after a newer capture has begun.
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let first = true;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: (constraints: MediaStreamConstraints) => {
        if (!first) return original(constraints);
        first = false;
        return new Promise<MediaStream>((_, reject) =>
          window.addEventListener(
            "reject-old-permission",
            () => reject(new DOMException("late rejection", "NotAllowedError")),
            { once: true },
          ),
        );
      },
    });
  });
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(
    page.getByText("请在浏览器中允许麦克风。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "丢弃录音", exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByText("正在录音", { exact: false })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("reject-old-permission")),
  );
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await expect(page.getByLabel("录音草稿试听")).toBeVisible();
  await page.getByRole("button", { name: "丢弃录音", exact: true }).click();
  await record(page);
  const audio = page.getByLabel("录音草稿试听");
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  expect(
    (await (await page.request.get(`/api/practices/${id}`)).json()).attempts,
  ).toEqual([]);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "返回练习记录", exact: true }).click();
  await expect(page).toHaveURL(practiceURL);
  await expect(audio).toBeVisible();
  await page.getByRole("button", { name: "丢弃录音", exact: true }).click();
  await expect(audio).toBeHidden();
  await record(page);
  await page.getByRole("button", { name: "重新录音", exact: true }).click();
  await expect(page.getByText("正在录音", { exact: false })).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await expect(audio).toBeVisible();
  await page.route("**/recordings", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "提交本次录音", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "录音尚未提交",
  );
  expect(
    (await (await page.request.get(`/api/practices/${id}`)).json()).attempts,
  ).toEqual([]);
  await page.unroute("**/recordings");
  await page.route("**/submissions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "提交本次录音", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "接收结果尚未确认",
  );
  await page.unroute("**/submissions");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText("已接收 · 待识别", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeEnabled();
  expect(
    (await (await page.request.get(`/api/practices/${id}`)).json()).attempts,
  ).toHaveLength(1);
  // A lookup with no result is not permission to create a new submission ID.
  await record(page);
  let interruptedId = "";
  await page.route("**/submissions", async (route) => {
    interruptedId = route.request().postDataJSON().submissionId;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "提交本次录音", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "接收结果尚未确认",
  );
  await page.unroute("**/submissions");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "尚未查到接收记录",
  );
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toHaveCount(0);
  const resent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/submissions"),
  );
  await page.getByRole("button", { name: "核对并重发同一次提交" }).click();
  expect((await resent).postDataJSON().submissionId).toBe(interruptedId);
  await expect(page.getByText("已接收 · 待识别", { exact: true })).toHaveCount(
    2,
  );
  expect(
    (await (await page.request.get(`/api/practices/${id}`)).json()).attempts,
  ).toHaveLength(2);
  await page.screenshot({
    path: `test-results/recording-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
