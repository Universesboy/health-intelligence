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

`COACHCHALK_DB` 那一项填 Coachchalk 的数据库 ID（`coachos`，可在 Coachchalk 仓库的 `cloudflare/wrangler.migrations.jsonc` 或 `npx wrangler d1 list` 里找到）。本系统对它只执行 SELECT。

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
2. **接收接口应用（优先级更高）**：Self-hosted，同一域名，路径 `/ingest/*`。Policy：**Service Auth** → 选择一个新建的服务令牌（Access → Service Auth → Create Service Token，名字如 `health-auto-export`）。记下它的 Client ID 和 Client Secret。

这样 `/ingest/*` 必须同时带 Access 服务令牌和本系统的数据源令牌，两者任一泄露都可以单独停用。

## 6. 配置 Health Auto Export（iPhone）

先在网页 **数据源** 页点“生成令牌”，复制显示的 URL 和 Bearer 令牌（只显示一次）。

在 Health Auto Export → Automations → 新建 → REST API（不同版本的选项名称可能略有差异）：

- URL：`https://health.你的域名/ingest/hae`
- Headers：
  - `Authorization: Bearer <数据源令牌>`
  - `CF-Access-Client-Id: <服务令牌 Client ID>`
  - `CF-Access-Client-Secret: <服务令牌 Client Secret>`
- Export Format：JSON；Workout 格式选 Version 2
- **Summarize Data：打开**（系统需要每日汇总的睡眠格式）
- Time Grouping / Aggregation：**Hours**，之后不要再改（改变聚合粒度会让同一时段出现两种粒度的数据）
- Date Range / Period：**Previous 7 Days**（每次重发最近 7 天，漏掉的自动补齐，后端去重）
- Sync Interval：每 1–2 小时（iOS 只在手机解锁时允许读取健康数据，实际执行时间不保证）
- 勾选指标：Step Count、Walking + Running Distance、Flights Climbed、Active Energy、Basal Energy Burned、Weight & Body Mass、Body Fat Percentage、Waist Circumference、Walking Speed、Walking Step Length、Walking Asymmetry、Walking Double Support、Dietary Water；有 Apple Watch 后加 Heart Rate、Resting Heart Rate、Heart Rate Variability、Sleep Analysis、VO2 Max；有血压计后加 Blood Pressure。勾选 Workouts。
- 按 App 提示添加 Automations 桌面小组件（后台运行需要它）。

## 7. 导入历史

Health Auto Export → Manual Export，格式 JSON，同样的 Summarize/Hours 设置，时间范围选过去 1–2 年（文件太大就按半年分几次），然后在网页 **导入历史** 页上传。

## 8. 验收

1. 无痕窗口打开 `https://health.你的域名/`，出现 Cloudflare Access 登录。
2. 登录后能看到“今天”页和签到表单。
3. 不带请求头 `curl -X POST https://health.你的域名/ingest/hae` 被 Access 拒绝。
4. 在 Health Auto Export 里对该自动化点“Run now”（或等下一次同步），**数据质量** 页出现一条 processed 的数据包。
5. 再运行一次，数据质量页的数值不变（无重复）。
6. 上传历史文件后，步数、体重等天数与健康 App 大致一致。
7. 第二天检查后台任务行显示 `coachchalk: ok` 和导入的课程数。
