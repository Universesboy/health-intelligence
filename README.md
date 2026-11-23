# Health Intelligence

Colin 的个人长期健康系统。Phase 1：健康数据底座。

完整设计见 [Phase 1 架构与计划](https://claude.ai/artifact/VhUQE8jwrF3SRftZwhazDr)。部署步骤见 [docs/SETUP.md](docs/SETUP.md)。

## 现在能做什么

- 接收 iPhone 健康数据：Health Auto Export 的 REST API 自动化 POST 到 `/ingest/hae`，每个数据源有独立令牌。
- 导入历史：在 `/import` 上传 Health Auto Export 手动导出的 JSON。
- 自动导入教学时长：每小时从 Coachchalk 的 D1 只读读取已完成的课程（只允许 SELECT）。
- 每日 20 秒签到：睡眠时间、睡眠质量、教学强度、整体 RPE、疲劳、酸痛和疼痛部位、危险症状。
- 计算每日指标、28/90 天个人基线（中位数 + MAD，少于 14 天显示“基线建立中”）、教学负荷与训练负荷双轨。
- 数据质量页、全部导出（JSON）、按数据源或全部删除。

还没有做（按计划在后续阶段）：饮食拍照识别、恢复提示与每日 1–3 个行动、AI 解释、提醒推送。

## 数据原则

- 原始数据包用 AES-256-GCM 加密后存 R2；D1 只存解析后的必要字段。
- 只接收白名单里的指标，其余计数后丢弃。未知单位直接拒绝，不猜。
- 每条记录按“指标 + 时间 + 设备”去重，同一段数据重复发送只会原地更新。
- 缺失就是缺失：负荷缺少输入时显示为空，不用 0 或估计值代替。设备睡眠和自报睡眠分开存，永不混用。
- 日志只记录批次 ID 和条数，不记录任何健康数值。
- 时间以 UTC 存储，本地日期按 America/Vancouver 计算。B.C. 从 2026-03-08 起全年使用 UTC-7，系统依赖运行时的 tzdata，测试覆盖了这一变化。

## 技术栈

Cloudflare Workers + D1 + R2 + Queues + Cron Triggers，Hono 路由，Drizzle 管理表结构与迁移，Vitest 单元测试。和 Coachchalk 在同一个 Cloudflare 账号，使用独立的数据库。

## 开发

```bash
npm ci
cp .dev.vars.example .dev.vars   # 填入 RAW_ENCRYPTION_KEY
npm run db:migrate:local
npm run dev                      # http://localhost:8787
npm test
npm run typecheck
```

修改 `src/db/schema.ts` 后运行 `npm run db:generate` 生成新的迁移文件。
