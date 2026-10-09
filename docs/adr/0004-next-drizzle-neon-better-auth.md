---
status: accepted
---

# 使用 Next.js、Drizzle、Neon 和 Better Auth 重建单个应用

2026-10-07，用户在比较现有方案和候选方案后，确认新版本采用 Next.js、Drizzle、Neon、Better Auth，以 Vercel 为首选部署平台。保持单个应用并按业务组织模块，适应个人维护和首版集中于一条学习流程的范围；不预先增加独立后端或多应用部署。

Drizzle 的 TypeScript 表定义和 SQL 风格查询符合用户偏好；Neon 符合已确定的退出 Supabase 方向；Better Auth 承接完整的邮箱注册、验证、登录和密码恢复流程。保留 Prisma 或 Supabase 在技术上仍可行，但用户允许放弃旧数据与模型，不要求为减少迁移改动而保留原选型。本决定不声称新组合更快、更便宜，或自动提高业务代码质量。

代价包括新的认证表、迁移和服务适配，以及邮件和数据库服务的配置工作。Vercel 的语音处理适配、中国大陆与海外的实际访问需部署验证；音频存储仍按用户要求暂缓决定。具体依赖版本在实施时锁定相容的稳定版本，不因文档出现预发布示例而默认依赖预发布能力。

依据：[ORM 比较](../research/2026-10-07-orm-comparison.md)、[数据库托管比较](../research/2026-10-07-database-hosting-comparison.md)、[认证与部署核查](../research/2026-10-07-auth-deployment.md)。研究文档保留调研时的候选状态，最终选择以本 ADR 为准。
