import type { FeedbackConfiguration } from "./bailian";
import { feedbackModel, supportedFeedbackModels } from "./bailian";
export function readFeedbackConfig(
  env: NodeJS.ProcessEnv,
): FeedbackConfiguration | undefined {
  if (env.REAL_FEEDBACK_ENABLED !== "true") return undefined;
  const model = supportedFeedbackModels.find(
    (candidate) => candidate === (env.FEEDBACK_MODEL ?? feedbackModel),
  );
  if (
    !model ||
    (model !== feedbackModel && env.FEEDBACK_FREE_MODEL_VERIFIED !== model)
  )
    throw new Error(
      "反馈型号必须明确允许，切换型号前须分别核实其免费额度及用完即停。",
    );
  const config = {
    enabled: true,
    model,
    apiKey: env.DASHSCOPE_API_KEY?.trim() ?? "",
    host: env.DASHSCOPE_API_HOST ?? "",
    freeTokenBudget: Number(env.FEEDBACK_FREE_TOKEN_BUDGET),
    freeUntil: new Date(env.FEEDBACK_FREE_UNTIL ?? ""),
  };
  if (
    env.DEVELOPMENT_FEEDBACK === "true" ||
    !config.apiKey ||
    !/^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(config.host) ||
    !Number.isSafeInteger(config.freeTokenBudget) ||
    config.freeTokenBudget <= 0 ||
    !Number.isFinite(config.freeUntil.getTime()) ||
    env.FEEDBACK_FREE_ONLY_VERIFIED !== "true"
  )
    throw new Error(
      "真实反馈须核实免费额度及用完即停，配置有效期限与累计 token 上限，且禁用开发替身。",
    );
  return config;
}
