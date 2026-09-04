# 糖豆人 自助计时系统（self-service timer）

这是从 Tangdouren 项目里单独抽取的"自助计时"功能包，用于融合进官网项目。路径结构与官网仓库根目录一一对应，按下方步骤操作即可。

## 集成步骤

### 1. 先跑数据库迁移

把 `supabase/migrations/012_self_service_timer.sql` 放到你仓库的 `supabase/migrations/` 下并执行（或直接对数据库跑一遍该 SQL）。

迁移内容：给 `timer_sessions` 表加 `table_number`、`created_via`、`idempotency_key` 三个字段，加约束和索引。**不跑迁移的话，下面的代码一运行就会报列不存在。**

### 2. 拷贝新增文件

以下文件是纯新增，直接拷到官网仓库对应路径即可：

```
app/(site)/self-timer/page.tsx              自助计时入口页（扫码落地的页面）
app/(site)/self-timer/session/[id]/page.tsx 进行中的计时会话页（顾客端）
app/api/self-timer/start/route.ts           自助开台接口
app/api/self-timer/session/[id]/route.ts    会话状态/暂停/结束接口
app/api/self-timer/tables/route.ts          可用桌位查询接口
lib/timer/selfService.ts                    自助业务逻辑
lib/timer/selfServiceCore.ts                计时核心（计费/状态流转）
lib/timer/sessionId.ts                      session_id 生成（后台自助共用）
public/self-timer-tutorial/                 顾客操作教程图（9 张）
tests/selfServiceCore.test.ts               核心逻辑单元测试
```

### 3. 合并被改动的已有文件

以下文件是相对交付基线（Tangdouren 主分支）的改动版。如果你的官网代码和基线一致，直接覆盖；如果你们自己改过这些文件，建议按下面说明手动 diff 合并：

| 文件 | 改动内容 |
|---|---|
| `app/(admin)/dashboard/timers/page.tsx` | 列表显示桌号徽标、来源标签（后台/预约/自助）；计时中/暂停订单显示实时预估金额；计时按暂停时长扣除 |
| `app/(admin)/dashboard/timers/[id]/page.tsx` | 显示桌号与来源；新增"修改座位号"输入框；自助会话分享链接指向 `/self-timer/session/xxx` |
| `app/api/admin/timers/route.ts` | 创建计时单时自动带预约桌号与 `created_via`；session_id 生成改用公共模块 `lib/timer/sessionId.ts` |
| `app/api/admin/timers/[id]/route.ts` | 新增 `update_table` 动作（改座位号），其余动作不变 |
| `lib/booking/availabilityService.ts` | 仅类型收紧（`any` 改为具体类型），无行为变化，可整文件覆盖 |
| `package.json` | 仅 lint 脚本一行：`next lint` 改为 `eslint . --ext .js,.jsx,.ts,.tsx` |
| `tsconfig.json` | 仅加一行 `"allowImportingTsExtensions": true` |

### 4. 环境变量

不需要新增。自助端只用到 `NEXT_PUBLIC_APP_URL`（官网已有），数据库走现有的 Supabase anon/admin key。

### 5. 验证

1. 跑 `npm run build`（或 `tsc --noEmit`）确认编译通过；
2. 浏览器打开 `/self-timer`，选桌位开台，确认能创建会话；
3. 用 `/self-timer/session/<session_id>` 打开会话页，测试暂停和结束；
4. 后台 `timers` 列表和详情页能看到自助会话（带"自助"来源标签），详情页可修改顾客填错的座位号；
5. 可选：`npm test` 跑 `tests/selfServiceCore.test.ts`。

## 未包含的改动（有意排除）

- `app/(admin)/login/page.tsx` 里 `<a>` 换 `<Link>` 的改动与功能无关，未包含；
- 仓库根目录的 `.gitignore`、`.eslintrc.json` 属于本仓库工程配置，按你们自己的来；
- 本地"图片教程"源文件文件夹与 `public/self-timer-tutorial/` 内容完全相同，只保留了一份。

## 已知依赖

本功能假设官网已有：计时定价模块 `lib/timer/pricing.ts`、`timer_sessions` 表及暂停字段（`paused_at` / `total_paused_ms`）、Supabase 客户端封装。若你们的基线不是 Tangdouren 主分支，先对齐基线再合。
