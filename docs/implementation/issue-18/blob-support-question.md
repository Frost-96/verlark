# Vercel Blob 清理边界咨询草稿

状态：2026-10-11 经维护者明确授权，已发送至 Vercel Support 官方助手。助手生成答复报错；转正式工单并选择 CDN > Blob 后，页面限制 Hobby 账户使用社区或付费支持，未生成工单号。尚无供应商答复或清理保证。维护者随后明确授权将同一正文发布到 Vercel Community；首次登录仍需完成身份授权及社区协议确认，尚未公开发布。正文仅包含通用技术问题，不包含账号标识、密钥、项目配置、对象 URL 或学习者数据。

Subject: Verifiable cleanup of in-flight and incomplete multipart uploads in private Blob

We use private Vercel Blob with @vercel/blob 2.8.1. Our application immediately denies access when a recording is deleted or expires. We need a documented way to determine when its temporary and final objects, including incomplete multipart parts, have actually been removed and cannot be recreated by a previously authorized upload.

1. After a client token or signed URL expires, can a request started before expiry still finish? Is there a documented maximum lifetime or a server-side cancellation operation with a verifiable completion result?
2. Can we issue an upload capability that the Blob service enforces as single-object PUT only, prohibiting all multipart operations? The signed-token docs describe `put` as covering both single PUT and multipart POST.
3. How can an application list and abort all incomplete multipart uploads for a pathname or prefix, including uploads whose creation response was lost? If these are automatically reclaimed, what is the documented retention limit, and how can completion be verified?
4. Does `ifMatch` enforce its precondition atomically when a PUT or multipart completion commits, including a concurrent deletion? We understand that rejecting completion alone would not establish that all uploaded parts were reclaimed.
5. On Hobby, if Blob access is paused after exceeding included usage, are management deletion and multipart cleanup still available? If not, what is the no-upgrade recovery procedure?

Please point us to supported APIs and documented guarantees. A client-side abort, an expired token, or a 404 for an assembled object alone does not establish the physical cleanup boundary we need. We are not requesting a guarantee that provider security logs or backups are erased.
