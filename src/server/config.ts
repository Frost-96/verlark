export class ConfigurationError extends Error {}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const developmentFeedback = env.DEVELOPMENT_FEEDBACK === "true";
  if (
    developmentFeedback &&
    env.NODE_ENV !== "development" &&
    env.NODE_ENV !== "test"
  )
    throw new ConfigurationError("正式环境或未指定环境不能启用开发反馈替身。");
  const production = env.NODE_ENV === "production";
  const developmentTranscription = env.DEVELOPMENT_TRANSCRIPTION === "true";
  if (
    developmentTranscription &&
    env.NODE_ENV !== "development" &&
    env.NODE_ENV !== "test"
  )
    throw new ConfigurationError("正式环境或未指定环境不能启用开发识别替身。");
  const developmentRecordings = env.DEVELOPMENT_RECORDINGS === "true";
  if (developmentRecordings && production)
    throw new ConfigurationError("正式环境不能启用开发录音文件 Adapter。");
  const developmentMail = env.DEVELOPMENT_MAIL === "true";
  if (developmentMail && production) {
    throw new ConfigurationError("正式环境不能启用开发邮件替身。");
  }
  const databaseURL = env.DATABASE_URL;
  if (!databaseURL)
    throw new ConfigurationError("请配置 DATABASE_URL，使用新的应用数据库。");
  try {
    const url = new URL(databaseURL);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new ConfigurationError("数据库连接配置格式不正确。");
  }
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new ConfigurationError("请配置至少 32 个字符的 BETTER_AUTH_SECRET。");
  const baseURL = env.BETTER_AUTH_URL;
  try {
    if (!baseURL) throw new Error();
    const url = new URL(baseURL);
    if (
      url.origin !== baseURL ||
      !["http:", "https:"].includes(url.protocol) ||
      (production && url.protocol !== "https:")
    )
      throw new Error();
  } catch {
    throw new ConfigurationError(
      "请配置有效的 BETTER_AUTH_URL；正式环境需要 HTTPS。",
    );
  }
  const allowedEmails = new Set(
    (env.TESTER_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowedEmails.size)
    throw new ConfigurationError("请配置测试名单 TESTER_EMAILS。");
  return {
    databaseURL,
    secret,
    baseURL: baseURL!,
    allowedEmails,
    developmentMail,
    developmentRecordings,
    developmentTranscription,
    developmentFeedback,
    production,
  };
}
export type AppConfig = ReturnType<typeof readConfig>;
