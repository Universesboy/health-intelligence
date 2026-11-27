# 部署到你的 Cloudflare 账号

需要 Node.js 22.13+。所有命令在仓库根目录运行。不要把任何令牌或密钥贴到聊天、Git 或文档里。

## 1. 创建资源

```bash
npm ci
npx wrangler login
npx wrangler d1 create health
npx wrangler r2 bucket create health-raw
npx wrangler queues create health-ingest
npx wrangler queues create health-ingest-dlq
```

把 `d1 create` 打印的 `database_id` 填进 `wrangler.jsonc` 里 `DB` 那一项。

工时数据来自 Coachchalk 的 Work Feed：`wrangler.jsonc` 里的 `COACHCHALK_WORK` 服务绑定指向 `coachos` Worker 的 `HealthWorkFeed` 入口。本系统不读 Coachchalk 的数据库。

先部署 Coachchalk，再在 Coachchalk 的「工时」页打开「共享给 Coach Health」，最后部署本系统。`COACHCHALK_WORKSPACE_ID` 用 `wrangler secret put` 设置。没打开共享时，每小时的任务会跳过工时并保留已有数据，Coachchalk 会记录这次被拒绝的读取。

## 2. 建表

```bash
npm run db:migrate:remote
```

## 3. 密钥

```bash
npx wrangler secret put RAW_ENCRYPTION_KEY        # 64 位十六进制，见下方命令生成
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN     # 例如 yourteam.cloudflareaccess.com（和 Coachchalk 相同）
npx wrangler secret put CF_ACCESS_AUD             # 第 5 步应用的 AUD
npx wrangler secret put COACHCHALK_WORKSPACE_ID   # Coachchalk 中你的 workspace id，见下方查询
```

生成加密密钥：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`。
**这个密钥丢失后，R2 里的原始数据包将无法解密**（D1 中已解析的数据不受影响）。请把它另存到密码管理器。

查询 Coachchalk workspace id：

```bash
npx wrangler d1 execute coachos --remote --command "SELECT id, owner_email FROM workspaces WHERE mode = 'real'"
```

## 4. 部署

```bash
npm run deploy
```

建议在 Workers → health-intelligence → Settings → Domains & Routes 绑定一个自定义域名，例如 `health.你的域名`。路径级的 Access 规则需要自定义域名。

## 5. Cloudflare Access

Zero Trust → Access → Applications：

1. **整站应用**：Self-hosted，域名 `health.你的域名`，路径留空。Policy：Allow → Emails → 你的邮箱。登录方式与 Coachchalk 相同（One-time PIN）。把 Application Audience (AUD) 填入 `CF_ACCESS_AUD`。
2. **接收接口应用（优先级更高）**：Self-hosted，同一域名，路径 `/ingest/*`。Policy：**Bypass** → Include：Everyone。

   iPhone 上的 Health Auto Export 无法完成邮箱登录，所以 `/ingest/*` 不走 Access 登录，改由本系统检查每台设备独立的数据源令牌（256 位随机数，只存哈希，可在网页上单独停用）。没有有效令牌的请求返回 401，不会写入任何数据。

   如果你更想保留 Access 服务令牌（Policy 选 Service Auth），把它存成 Worker 密钥，一键链接会自动带上：

   ```bash
   npx wrangler secret put HAE_ACCESS_CLIENT_ID
   npx wrangler secret put HAE_ACCESS_CLIENT_SECRET
   ```

## 6. 连接 iPhone（Health Auto Export）

在 iPhone 上打开 `https://health.你的域名/connect`（菜单「连接 Apple Health」），按页面的 5 步走：

1. 安装 Health Auto Export（自动同步需要 Premium，有 7 天试用），允许它读取健康数据。
2. 点「生成一键配置链接」，再点「在 Health Auto Export 中创建自动同步」。App 会用官方 deep link（`com.HealthExport://automation?...`）新建一个填好的 REST API 自动化：地址、令牌、JSON v2、按小时汇总、汇总睡眠、Previous 7 Days、每小时同步、全部指标。点保存即可。训练记录是第二个可选链接。
3. 在自动化里手动运行一次，网页会实时显示收到的第一批数据和各指标条数。
4. 历史数据：在同一个自动化里 Export Existing Data → Manual Upload，按半年一段上传。
5. 保持运行：打开后台 App 刷新、避免低电量模式、加小组件。超过 2 天没收到数据，“今天”页会提醒。

生成新链接时，之前生成但从未收到数据的令牌会自动停用。链接含有令牌，不要分享截图。手动填写的值也在向导页的折叠区里。

## 7. 导入历史（文件方式）

也可以在 Health Auto Export → Manual Export 导出 JSON（Summarize 打开、Hours 汇总），然后在网页 **导入历史** 页上传。

## 8. 验收

1. 无痕窗口打开 `https://health.你的域名/`，出现 Cloudflare Access 登录。
2. 登录后能看到“今天”页和签到表单。
3. 不带令牌 `curl -X POST https://health.你的域名/ingest/hae` 返回 401。
4. 在 Health Auto Export 里对该自动化点“Run now”（或等下一次同步），**数据质量** 页出现一条 processed 的数据包。
5. 再运行一次，数据质量页的数值不变（无重复）。
6. 上传历史文件后，步数、体重等天数与健康 App 大致一致。
7. 第二天检查后台任务行显示 `coachchalk: ok` 和导入的课程数。
