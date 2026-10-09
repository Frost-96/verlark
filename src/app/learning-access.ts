import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/server/composition";

export async function learningAccess() {
  const services = getServices();
  const learner = await services.identity.getCurrentLearner(await headers());
  if (!learner) redirect("/login");
  return { services, learner };
}
