# Health Intelligence

Colin 的个人长期健康系统。Phase 1：健康数据底座。

完整设计见 [Phase 1 架构与计划](https://claude.ai/artifact/VhUQE8jwrF3SRftZwhazDr)。部署步骤见 [docs/SETUP.md](docs/SETUP.md)。

## 现在能做什么

- **今天**：首页先回答“今天最值得关注什么”（最多 3 条），再一键记录恢复感受、睡眠质量和教学强度；详细字段折叠。
- **一句话记录**：例如「今天早上体重 77 公斤，昨晚睡了七个半小时，感觉恢复不错」。确定性规则识别（不是大模型），先预览、勾选、可修改，确认后才写入；没识别的部分会列出来。
- **快捷记录**：体重、饮水（+250/+500/+750）、腰围、饮食（描述 + 份量 + 蛋白质，常吃的一键重复），给同步来的训练补 RPE，记错可删除。
- **自动数据**：iPhone 健康数据经 Health Auto Export 每 1–2 小时推送（含任何写入 Apple Health 的饮食、智能秤、血压数据）；Coachchalk 工时每小时同步。
- **趋势**：睡眠、体重（7 天平滑 + 目标线）、步数、主观恢复、教学 + 训练负荷，30 天 / 90 天 / 1 年；个人基线灰带。
- **洞察**：近 7 天 vs 之前 4 周的变化、体重周趋势、作息规律、负荷比、相关性（≥21 天配对、标明不等于因果）、数据质量问题；结论变化时才保存一份历史。
- **数据**：按目标动态加权的“可分析程度”，每项分析说明现在能做什么、缺什么、能否自动获取，以及当前目标下可以不收集的数据；数据来源目录如实标注“已连接 / 需要设备 / 规划中 / 不适用”。
- **档案与目标**：所有字段可选；目标历史保留。导入历史、导出全部数据、按来源删除。

本地预览（合成数据，不需要 Cloudflare 账号）：`npx tsx scripts/preview.ts`，打开 http://localhost:8788。设计规范见 [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)，与 Coachchalk 的连接与授权规划见 [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md)。

还没有做：饮食拍照识别、健康报告/截图识别、提醒推送、与教练共享。

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
