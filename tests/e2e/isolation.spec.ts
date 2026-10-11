import { test, expect, type APIRequestContext } from "@playwright/test";
import { signIn } from "./helpers";
import type {
  Attempt,
  PracticeDetail,
} from "../../src/modules/practice/contracts";

const origin = { origin: "http://localhost:3100" };
async function fixture(request: APIRequestContext) {
  const started = await request.post("/api/practices", {
    headers: origin,
    data: { materialKey: "weekend-plans", requestId: crypto.randomUUID() },
  });
  expect(started.status()).toBe(201);
  const { id } = await started.json();
  const base = `/api/practices/${id}`;
  const upload = await request.post(`${base}/recordings`, {
    headers: { ...origin, "content-type": "audio/webm" },
    data: Buffer.from([1, 2, 3]),
  });
  expect(upload.status()).toBe(201);
  const { reference } = await upload.json();
  const submitted = await request.post(`${base}/submissions`, {
    headers: origin,
    data: { submissionId: crypto.randomUUID(), reference },
  });
  expect(submitted.status()).toBe(201);
  const attempt: Attempt = await submitted.json();
  const transcription = `${base}/attempts/${attempt.id}/transcription`;
  const recognized = await request.post(transcription, {
    headers: origin,
    data: { action: "recognize" },
  });
  expect(recognized.status()).toBe(200);
  const raw = (await recognized.json()).rawTranscript;
  const confirmation = await request.post(transcription, {
    headers: origin,
    data: {
      action: "confirm",
      rawTranscriptId: raw.id,
      expectedConfirmationId: null,
      text: "I will read tomorrow.",
    },
  });
  expect(confirmation.status()).toBe(200);
  const confirmed: Attempt = await confirmation.json();
  const confirmationId = confirmed.confirmations[0]!.id;
  const feedback = await request.post(
    `${base}/attempts/${attempt.id}/feedback`,
    {
      headers: origin,
      data: { action: "generate", confirmationId },
    },
  );
  expect(feedback.status()).toBe(200);
  return { id, base, reference, attempt, raw, confirmationId };
}

test("A04 两个真实会话覆盖全部练习 HTTP 操作、嵌套标识与删除记录读取", async ({
  browser,
  playwright,
}, info) => {
  const alice = await browser.newContext({ baseURL: "http://localhost:3100" });
  const bob = await browser.newContext({ baseURL: "http://localhost:3100" });
  const anonymous = await playwright.request.newContext({
    baseURL: "http://localhost:3100",
  });
  try {
    const aLogin = await signIn(
      alice.request,
      `${process.env.E2E_PREFIX}-isolation-a-${info.project.name}@example.com`,
    );
    const bLogin = await signIn(
      bob.request,
      `${process.env.E2E_PREFIX}-isolation-b-${info.project.name}@example.com`,
    );
    const a = await fixture(alice.request);
    const b = await fixture(bob.request);
    const deleted = await fixture(bob.request);
    expect(
      (
        await bob.request.delete(`${deleted.base}/deletion`, {
          headers: origin,
        })
      ).status(),
    ).toBe(200);
    const bBefore: PracticeDetail = await (
      await bob.request.get(b.base)
    ).json();
    const aBefore = await (await alice.request.get(a.base)).json();
    const receipt = await (
      await bob.request.get(`${deleted.base}/deletion`)
    ).json();
    const operations = [
      { name: "read", method: "GET", path: b.base },
      {
        name: "findSubmission",
        method: "GET",
        path: `${b.base}/submissions?submissionId=${b.attempt.submissionId}`,
      },
      {
        name: "saveRecording",
        method: "POST",
        path: `${b.base}/recordings`,
        data: Buffer.from([4]),
        audio: true,
      },
      {
        name: "submit",
        method: "POST",
        path: `${b.base}/submissions`,
        data: { submissionId: crypto.randomUUID(), reference: b.reference },
      },
      ...["recognize", "recover"].map((action) => ({
        name: `transcription:${action}`,
        method: "POST",
        path: `${b.base}/attempts/${b.attempt.id}/transcription`,
        data: { action },
      })),
      {
        name: "confirm",
        method: "POST",
        path: `${b.base}/attempts/${b.attempt.id}/transcription`,
        data: {
          action: "confirm",
          rawTranscriptId: b.raw.id,
          expectedConfirmationId: b.confirmationId,
          text: "I will read a book this weekend.",
        },
      },
      ...["generate", "recover"].map((action) => ({
        name: `feedback:${action}`,
        method: "POST",
        path: `${b.base}/attempts/${b.attempt.id}/feedback`,
        data: { action, confirmationId: b.confirmationId },
      })),
      { name: "finish", method: "POST", path: `${b.base}/finish`, data: {} },
      {
        name: "repeat",
        method: "POST",
        path: `${b.base}/repeat`,
        data: { requestId: crypto.randomUUID() },
      },
      { name: "delete", method: "DELETE", path: `${b.base}/deletion` },
      { name: "readDeletion", method: "GET", path: `${deleted.base}/deletion` },
      {
        name: "retryDeletion",
        method: "POST",
        path: `${deleted.base}/deletion`,
      },
    ];
    for (const operation of operations) {
      await test.step(operation.name, async () => {
        const headers = {
          ...origin,
          "x-user-id": bLogin.user.id,
          ...("audio" in operation ? { "content-type": "audio/webm" } : {}),
        };
        const options = {
          method: operation.method,
          headers,
          data: "data" in operation ? operation.data : undefined,
        };
        expect((await anonymous.fetch(operation.path, options)).status()).toBe(
          401,
        );
        expect(
          (await alice.request.fetch(operation.path, options)).status(),
        ).toBe(404);
        // Forged client identity never substitutes for the verified session.
        if ("data" in operation && !Buffer.isBuffer(operation.data)) {
          expect(
            (
              await alice.request.fetch(operation.path, {
                ...options,
                data: { ...operation.data, userId: bLogin.user.id },
              })
            ).status(),
          ).toBe(400);
        }
        expect(await (await bob.request.get(b.base)).json()).toEqual(bBefore);
        expect(
          await (await bob.request.get(`${deleted.base}/deletion`)).json(),
        ).toEqual(receipt);
        expect(await (await alice.request.get(a.base)).json()).toEqual(aBefore);
      });
    }
    // Collection reads and start are scoped to the session, with no owner argument.
    expect((await anonymous.get("/api/practices")).status()).toBe(401);
    expect(
      (
        await anonymous.post("/api/practices", {
          headers: origin,
          data: {
            materialKey: "weekend-plans",
            requestId: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(401);
    expect(
      await (
        await alice.request.get(`/api/practices?userId=${bLogin.user.id}`, {
          headers: { "x-user-id": bLogin.user.id },
        })
      ).json(),
    ).toEqual([expect.objectContaining({ id: a.id })]);
    expect(
      (
        await alice.request.post("/api/practices", {
          headers: origin,
          data: {
            materialKey: "weekend-plans",
            requestId: crypto.randomUUID(),
            userId: bLogin.user.id,
          },
        })
      ).status(),
    ).toBe(400);
    expect(await (await bob.request.get("/api/practices")).json()).toEqual([
      expect.objectContaining({ id: b.id }),
    ]);
    // An owned parent does not authorize a foreign attempt or confirmation.
    for (const action of ["recognize", "recover", "confirm"]) {
      const data =
        action === "confirm"
          ? {
              action,
              rawTranscriptId: b.raw.id,
              expectedConfirmationId: b.confirmationId,
              text: "I will read tomorrow.",
            }
          : { action };
      expect(
        (
          await alice.request.post(
            `${a.base}/attempts/${b.attempt.id}/transcription`,
            { headers: origin, data },
          )
        ).status(),
      ).toBe(404);
    }
    for (const action of ["generate", "recover"]) {
      expect(
        (
          await alice.request.post(
            `${a.base}/attempts/${b.attempt.id}/feedback`,
            {
              headers: origin,
              data: { action, confirmationId: b.confirmationId },
            },
          )
        ).status(),
      ).toBe(404);
      const swapped = await alice.request.post(
        `${a.base}/attempts/${a.attempt.id}/feedback`,
        { headers: origin, data: { action, confirmationId: b.confirmationId } },
      );
      expect(swapped.ok()).toBe(false);
    }
    const aPage = await alice.newPage();
    await aPage.goto(`/practice/${b.id}`);
    await expect(
      aPage.getByRole("heading", { name: "找不到该练习" }),
    ).toBeVisible();
    await aPage.goto("/practices");
    await expect(aPage.getByRole("link", { name: "继续练习" })).toHaveCount(1);
    await expect(aPage.getByRole("link", { name: "继续练习" })).toHaveAttribute(
      "href",
      `/practice/${a.id}`,
    );
    await expect(
      aPage.getByRole("region", { name: "删除与录音清理" }),
    ).toHaveCount(0);
    const bPage = await bob.newPage();
    await bPage.goto("/practices");
    await expect(
      bPage.getByRole("heading", { name: "练习记录已删除", exact: true }),
    ).toHaveCount(1);
    await expect(bPage.getByRole("link", { name: "继续练习" })).toHaveAttribute(
      "href",
      `/practice/${b.id}`,
    );
    expect(aLogin.user.id).not.toBe(bLogin.user.id);
    expect(await (await bob.request.get(b.base)).json()).toEqual(bBefore);
    expect(await (await alice.request.get(a.base)).json()).toEqual(aBefore);
    expect(
      await (await bob.request.get(`${deleted.base}/deletion`)).json(),
    ).toEqual(receipt);
  } finally {
    await alice.close();
    await bob.close();
    await anonymous.dispose();
  }
});
