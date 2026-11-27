# Coach Health 与 Coachchalk 的生态连接

原则：两个独立部署（各自的 Worker 和数据库），只通过**有授权、有日志、有版本号的接口**交换最少的数据。健康数据默认不出 Coach Health。

## 已经实现

- **Coachchalk → Health：教学工时**（`HealthWorkFeed.dailySummary`，Service Binding RPC）。教练在 Coachchalk「工时」页手动打开共享；每次读取写入 Coachchalk 的 `data_access_log`；未授权时 Health 保留已有数据，不把“读取失败”当成“没有工作”。

## 下一步（按顺序，每一步都需要用户明确授权）

1. **Health → Coachchalk：今日恢复摘要（只给自己）**
   在 Coachchalk 的「今天」页显示一个“恢复：良好 / 留意 / 数据不足”的标签，帮助安排自己当天的示范量。只传等级和一句话，不传原始数值。Health 新增 `CoachSummaryFeed` 入口，Coachchalk 只读，默认关闭。
2. **学生端（未来）**：学生拥有自己的 Coach Health 账号，数据归学生。
3. **学生 → 教练共享**：按“范围 × 期限”授权。

## 授权模型（学生共享时启用）

```
sharing_grants(id, owner_user_id, grantee_user_id, grantee_role[coach|parent], scopes JSON, created_at, expires_at, revoked_at)
scopes: recovery_level | sleep_summary | training_load | pain_reports | body_metrics   （没有 "all"）
access_log(id, grant_id, scope, purpose, accessed_at)
```

- 默认没有任何授权；家长和教练都看不到任何健康数据。
- 每个范围单独勾选，可设到期，可随时撤回；撤回立即生效。
- 教练只能通过授权读取，并且只能读到授权的范围；接口按 `owner_user_id` 过滤，不同学生的数据在查询层隔离。
- 用户能看到谁在什么时候因为什么读取了哪些数据。
- 体重、身体成分、疼痛记录属于更敏感的范围，单独授权，不随“恢复状态”一起打包。

## 身份

当前两个应用都由 Cloudflare Access 保护，只有 Colin 一个用户。Coachchalk 计划迁移到 Better Auth（公开注册）。学生共享上线前，Coach Health 需要同一身份体系（同一用户 ID），在此之前不做跨用户共享。
