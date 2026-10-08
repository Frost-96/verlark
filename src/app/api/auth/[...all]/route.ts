import { getServices } from "@/server/composition";
import { identityMessages } from "@/modules/identity/contracts";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    return await getServices().identity.handleAuthRequest(request);
  } catch {
    return Response.json(
      { message: identityMessages.unavailable },
      { status: 503 },
    );
  }
}
export { handle as GET, handle as POST };
