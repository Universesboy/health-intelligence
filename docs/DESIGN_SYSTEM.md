# Coachchalk × Coach Health 设计系统

两个应用共享同一套品牌基因，代码库保持独立。Coachchalk 的权威来源是 `AI-Coach-OS/app/globals.css`，Coach Health 在 `src/web/html.ts` 里使用**完全相同的 Token 名称和数值**，只在其上增加健康数据专用的层。

## 共享（两边必须一致）

| 层 | Token / 规则 |
|---|---|
| 颜色 | Paper `--color-bg #f3f1e7`，Board `--color-brand #1e2a24`，Chalk `--color-accent #c8f169`（只用在 Board 上或配 Board 文字），状态色 success / warning / danger / info 同值 |
| 字体 | 正文 Inter，标题与数字 Space Grotesk，中文回退 PingFang SC / Noto Sans SC；同一个 Google Fonts 链接 |
| 字号 | `--text-xs 12` … `--text-2xl 26`，数字用 `font-variant-numeric: tabular-nums` |
| 间距 / 圆角 | 4px 网格 `--space-*`；`--radius-sm 6 / md 8 / lg 12`，控件高度 `--control-h 40px` |
| 按钮 | primary = Board 底 + Chalk 字；secondary = 白底描边；ghost；danger |
| 图标 | 24px 网格描边图标（Lucide 风格，2px 线宽），内联 SVG，无图标依赖 |
| 导航 | 桌面左侧栏（品牌锁定 + 导航项，激活态 `--color-brand-soft`），手机底部 5 项导航 |
| 品牌标记 | 圆角方块 Chalk 底 + Board 笔画。Coachchalk = 五笔计数；Coach Health = 三笔计数 + 脉搏线 |
| 动效 | 120–160ms，`prefers-reduced-motion` 时全部关闭 |
| 响应式 | 760px 以下切换手机布局，页面左右 16px 边距，无横向滚动 |

## Coach Health 专属（健康表达更柔和）

- **数据系列色**：睡眠 `--series-sleep`（靛蓝）、活动 `--series-activity`（绿）、负荷 `--series-load`（琥珀）、身体 `--series-body`（蓝）、恢复 `--series-recovery`（青）。每个都有 `-soft` 底色。
- **深度**：卡片 `--radius-xl 18px` + 双层柔和阴影；首页 "Board" 深色主卡带两层叠纸和极轻的 `rotateX`，悬停时回正；等距三层状态板（睡眠 / 负荷 / 身体），颜色只表示状态，旁边一定有文字。
- **图表**：服务器端 SVG，真实值；缺失日留空不画 0；个人 28 天基线（中位数 ± 1.4826×MAD）为灰带；每张图都有文字摘要和天数。
- **不做**：粒子、霓虹、大面积玻璃拟态、持续运行的动画、影响文字可读性的背景。

## 为什么不合并成一个代码库 / 不建组件包

Coachchalk 是 React（vinext），Coach Health 是 Hono 服务器端 HTML，组件无法直接复用。共享的是 **Token 层**，不是组件。当两边真的需要同一个组件时，再抽出一个只含 CSS 变量的 `@coachchalk/tokens` 包（单个 `tokens.css`），两个仓库各自引入。在那之前，改 Token 时两边同步修改，PR 里互相引用。
