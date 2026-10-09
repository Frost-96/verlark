import {
  authErrorMessage,
  identityMessages,
} from "../../../modules/identity/contracts";
import type { createIdentity } from "../../../modules/identity/server";

const methods: Record<string, string> = {
  "sign-up/email": "POST",
  "sign-in/email": "POST",
  "sign-out": "POST",
  "send-verification-email": "POST",
  "verify-email": "GET",
  "request-password-reset": "POST",
  "reset-password": "POST",
  "revoke-sessions": "POST",
};

export async function handleIdentityRequest(
  request: Request,
  identity: ReturnType<typeof createIdentity>,
) {
  const path = new URL(request.url).pathname.replace("/api/auth/", "");
  if (!methods[path])
    return Response.json({ message: "该操作未开放。" }, { status: 404 });
  if (request.method !== methods[path])
    return Response.json({ message: "请求方式不正确。" }, { status: 405 });
  try {
    if (
      path === "revoke-sessions" &&
      !(await identity.getCurrentLearner(request.headers))
    )
      return Response.json(
        { message: identityMessages.unauthorized },
        { status: 401 },
      );
    const response = await identity.handleAuthRequest(request);
    if (response.ok || (response.status >= 300 && response.status < 400))
      return response;
    const error = await response.json().catch(() => ({}));
    return Response.json(
      {
        code: error.code,
        message:
          response.status === 429
            ? authErrorMessage("TOO_MANY_REQUESTS")
            : authErrorMessage(error.code),
      },
      { status: response.status, headers: response.headers },
    );
  } catch {
    return Response.json(
      { message: identityMessages.unavailable },
      { status: 503 },
    );
  }
}
