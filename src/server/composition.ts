import "server-only";
import { connectDatabase } from "../db/client";
import { createIdentity } from "../modules/identity/server";
import { createMailAdapter } from "../integrations/mail/server";
import { readConfig } from "./config";

function compose() {
  const config = readConfig();
  const connection = connectDatabase(config.databaseURL);
  return {
    identity: createIdentity(
      connection.db,
      config,
      createMailAdapter(config.developmentMail),
    ),
  };
}
const processServices = globalThis as typeof globalThis & {
  verlarkServices?: ReturnType<typeof compose>;
};
export function getServices() {
  return (processServices.verlarkServices ??= compose());
}
