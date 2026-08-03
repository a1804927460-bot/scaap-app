# Messs 上线安全与发布清单

## 先明确哪些内容可以公开

可以放进桌面应用：Supabase 项目 URL、项目 ID、publishable/anon key、Railway 公网域名、GitHub 仓库名。

绝对不能放进桌面应用、安装包或 GitHub：Supabase secret/service-role key、AI 服务商 API Key、Railway Token、代码签名证书密码、GitHub PAT。

Electron 的 `safeStorage` 只适合保存用户会话等设备凭据，不能让内置商业 API Key 变成不可提取。商业密钥必须只存在于服务端。

## 1. 配置 Supabase 项目

项目：`trmbhcniijedpmohkbzx`

1. 在 Supabase 控制台打开 Authentication，配置邮件登录、发件人、站点 URL 和允许的重定向地址。
2. 在 JWT Signing Keys 中迁移到非对称签名密钥。网关通过项目 JWKS 校验 JWT，并仅接受 `ES256`/`RS256`、正确 issuer、`authenticated` audience 和 role。
3. 在 SQL Editor 执行 `supabase/migrations/202608030001_gateway_security.sql`。
4. 创建测试用户，确认只能查询自己的 `profiles`、`ai_quotas`、`ai_usage`。
5. 使用普通用户 token 尝试插入 `ai_usage`、修改 `ai_quotas`，必须被 RLS 拒绝。
6. 记录 publishable key。它会进入客户端，属于公开配置。
7. 记录新的 secret key，仅用于 Railway。不要下载到源码目录。

迁移 SQL 默认每日额度为：对话 100 次、图片 20 次、视频 5 次。上线前按成本重新计算。

## 2. 部署 Railway 网关

1. 将整个 `messs-app-v14` 推送到 GitHub。
2. Railway 新建 Project，选择 Deploy from GitHub repo。
3. 服务的配置文件路径使用根目录的 `/railway.json`。不要把 Root Directory 设为 `gateway`，因为网关会复用根目录 `lib` 中经过测试的服务商协议模块。
4. 生成 Railway 公网域名，并强制使用 HTTPS。
5. 设置下列变量：

```text
NODE_ENV=production
SUPABASE_URL=https://trmbhcniijedpmohkbzx.supabase.co
SUPABASE_PUBLISHABLE_KEY=你的 publishable key
SUPABASE_SECRET_KEY=你的 secret key
REQUIRE_DURABLE_QUOTA=true
REQUESTS_PER_MINUTE=30
ALLOWED_ORIGINS=
WUYIN_API_KEY=服务商密钥
CHAT_API_ENDPOINT=对话服务 API Base URL
CHAT_API_KEY=对话服务密钥
CHAT_MODELS=模型1,模型2
```

6. 将 `SUPABASE_SECRET_KEY`、`WUYIN_API_KEY`、`CHAT_API_KEY` 和新增 provider key 全部设置为 Railway sealed variable。
7. 保持 `ALLOWED_ORIGINS` 为空。Electron 主进程请求没有浏览器 Origin；网页 Origin 默认拒绝。
8. 只有尚未迁移非对称 JWT 时，才可临时设置 `ALLOW_AUTH_USER_FALLBACK=true`。迁移完成后立即删除。
9. 访问 `/healthz`，应返回 `{"ok":true}`。其他 `/v1/*` 路由无 JWT 时必须返回 401。
10. 检查日志只包含 request ID、状态和错误码，不应出现提示词、附件、Authorization 或上游响应正文。

## 3. 配置桌面发布包

在 `config/runtime.json` 填写：

```json
{
  "supabaseUrl": "https://trmbhcniijedpmohkbzx.supabase.co",
  "supabasePublishableKey": "你的 publishable key",
  "aiGatewayUrl": "https://你的服务.up.railway.app",
  "githubOwner": "GitHub 用户或组织",
  "githubRepo": "仓库名"
}
```

不要在这里填写 Supabase secret key 或 AI Key。正式包在网关配置完整时会删除旧 `ai-media-secret.json`，设置页也不会显示本机 API Key 输入区。

开发期若必须测试旧直连，需显式设置 `MESSS_ALLOW_DIRECT_AI=1`，且只能运行未打包开发版。正式包不会自动降级到直连。

## 4. 配置 GitHub Actions 和自动更新

在 GitHub Repository Settings 添加 Actions Variables：

```text
SUPABASE_PUBLISHABLE_KEY
AI_GATEWAY_URL
```

添加 Actions Secrets：

```text
CSC_LINK
CSC_KEY_PASSWORD
```

`CSC_LINK` 保存 Windows 代码签名证书的安全下载地址或受支持的 base64 内容。公开测试前先完成代码签名；工作流在证书缺失时会停止发布。

发布命令：

```powershell
git tag v0.0.2
git push origin v0.0.2
```

`.github/workflows/release.yml` 会：

1. 从标签同步 `package.json` 版本。
2. 注入公开运行配置，不注入任何服务商密钥。
3. 运行桌面端、网关和隐私守卫测试。
4. 构建并签名 NSIS 安装包。
5. 发布安装包、`.blockmap` 和 `latest.yml` 到 GitHub Release。

Electron 自动更新依赖 `latest.yml` 和 Release 附件。建议使用公开仓库或至少公开的下载发布渠道；私有 GitHub Release 通常要求在用户机器上放 GitHub token，不适合消费级客户端。

## 5. 上线前必须验证

- 安装包已签名，签名发布者名称正确，未出现未知发布者。
- 用新用户完成注册、邮件确认、登录、刷新 token、退出登录。
- 断网、JWT 过期、额度耗尽、Railway 重启、服务商超时均有清晰错误，不丢失本地文件。
- `.env`、`.pem`、`.p12`、SSH/AWS/Kubernetes 凭据目录和带密码数据库 URL 会被拦截。
- AI 图片附件在上传前已转为最大 2048 px WebP，EXIF/GPS/ICC 等元数据不保留。
- 伪造 provider endpoint 不会让网关请求任意网址；服务端只认 provider ID 注册表。
- 普通用户无法调用 `reserve_ai_request`，只有 Railway 的 secret key 可以调用。
- Railway 预算告警、服务商余额告警、Supabase 数据库告警均已开启。
- Supabase Point-in-Time Recovery 或定期备份已配置并演练恢复。
- 隐私政策明确说明：哪些文件只保存在本机，哪些附件在用户发起 AI 操作时会发送到服务端，保留多久。
- 用户协议、内容安全规则、账号删除和数据导出流程已准备。

## 6. 分阶段上线建议

1. 内测：5 到 20 人，低额度，人工查看失败率和成本。
2. Alpha：邀请制，限制图片/视频额度，验证自动更新和崩溃恢复。
3. Beta：开放注册，加入付费前先完成退款、滥用、封禁和客服流程。
4. Stable：扩大额度前至少观察一周网关成本、P95 延迟、失败率和更新成功率。

不要承诺“绝对不会泄露”。上线安全依赖持续轮换密钥、更新依赖、审计 RLS、监控成本和及时发布修复。
