export type Learner = { id: string; email: string; name: string };
export const identityMessages = {
  unavailable: "身份服务暂时不可用，请稍后重试或联系维护者检查配置。",
  unauthorized: "请先验证邮箱并登录。",
  invalidToken: "链接无效、已过期或已使用，请重新申请。",
};
export function authErrorMessage(code?: string): string {
  switch (code) {
    case "NOT_INVITED":
      return "该邮箱不在测试名单中，请联系维护者。";
    case "EMAIL_NOT_VERIFIED":
      return "请先验证邮箱，再登录。";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "邮箱或密码不正确。";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "该邮箱可能已经注册，请尝试登录或找回密码。";
    case "PASSWORD_TOO_SHORT":
      return "密码至少需要 12 个字符。";
    case "PASSWORD_TOO_LONG":
      return "密码不能超过 128 个字符。";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return identityMessages.invalidToken;
    case "TOO_MANY_REQUESTS":
      return "操作过于频繁，请稍后重试。";
    default:
      return "操作未完成，请检查输入后重试；若仍失败，请联系维护者。";
  }
}
