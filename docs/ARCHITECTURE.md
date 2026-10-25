# 架构说明（ARCHITECTURE）

## 总览

三端（Web / Windows / Android）共用同一套 React UI、TypeScript 业务计算、数据实体与状态逻辑；只有「存储介质」与「原生能力」通过平台适配器区分。**禁止开发三套互不关联的产品**——所有平台差异收敛在 `src/storage/index.ts` 一个工厂函数里。

```text
┌────────────────────────────────────────────────┐
│  UI 层  src/app / src/features / src/components │  四 Tab：今日 / 看板 / 周报 / 我的
├────────────────────────────────────────────────┤
│  状态层  src/state/AppData.tsx                   │  AppDataProvider（Context）：加载、
│                                                  │  变更、种子、导入导出、完成庆祝
├────────────────────────────────────────────────┤
│  领域层  src/domain/                             │  纯函数（无 IO、可注入时钟）：
│  dates / progress / suggestion / prediction /    │  建议量、完成率、近7天预测、
│  streak / weekly / validation                    │  连续+休息日、周报环比、Zod 校验
├────────────────────────────────────────────────┤
│  存储层  src/storage/                            │  StudyRepository 接口
│   ├─ indexeddb.ts   Web（Dexie/IndexedDB）        │
│   ├─ sqlite.ts      Tauri（plugin-sql/SQLite）    │  动态导入，Web 构建不加载
│   ├─ migrations/    SQLite 版本迁移               │
│   └─ seed.ts        首次启动演示数据               │
└────────────────────────────────────────────────┘
```

## 关键决策

### 1. 单一事实来源

**数据库中的原始记录（Goal / Checkin / WeeklyReview）是唯一事实**。完成率、连续天数、预计完成日、周报环比全部是渲染时从记录推导的派生计算（`src/domain`），绝不落库、绝不缓存过期值。补记或删除后一切数字自动重算。

### 2. 日期处理

- 业务日期一律为本地日历日字符串 `YYYY-MM-DD`（`DateStr`）。
- `src/domain/dates.ts` 的 `parseDate` 锚定**当地正午**构造 Date，规避 DST 偏移；`toDateStr` 只读本地字段。
- **严禁** `toISOString().slice(0, 10)`（会把本地日期错误转成 UTC 造成跨日错位）。
- 所有业务函数接受 `today: DateStr` 参数；`AppDataProvider` 用系统时钟每分钟刷新一次「今天」；测试注入 `fixedClock`。

### 3. 存储适配器

`StudyRepository`（`src/storage/types.ts`）定义统一契约；两个实现：

| | WebIndexedDbRepository | TauriSqliteRepository |
|---|---|---|
| 介质 | 浏览器 IndexedDB（Dexie） | 应用私有目录 SQLite（tauri-plugin-sql） |
| 迁移 | Dexie `version(n).stores()` | `PRAGMA user_version` + `SQLITE_MIGRATIONS` |
| 事务 | Dexie transaction | `BEGIN/COMMIT/ROLLBACK` |
| 级联删除 | 手动（同事务删 checkins） | 手动（同上）+ `ON DELETE CASCADE` 兜底 |

平台检测 `isTauri()`（`'__TAURI_INTERNALS__' in window`）只出现在 `storage/index.ts`；SQLite 模块动态 `import()`，Web 构建把它拆成独立 chunk（构建产物中 `sqlite-*.js` 仅在原生环境加载）。

### 4. 状态管理

不引入全局状态库；`AppDataProvider` 持有全部实体（个人工具数据量小，全量加载 + 变更后重读最简单可靠）：

- 所有变更（`addCheckin` 等）先走 Repository 真实写库，**成功后**才 `loadAll()` 刷新并更新 `settings.lastSavedAt`；失败抛错由页面 Toast 提示，绝不假成功。
- 首次完成庆祝：`completedSnapshot` 记录已完成的 goal id，仅当「本次 addCheckin 写入成功且该目标从未完成→完成」时触发一次彩带。
- 种子只在「无 settings 记录 且 目标表为空」时插入一次；`clearAll` 后会写入 `demoSeeded: true` 的空设置，避免清空后再次播种。

### 5. UI/UX

- Tailwind + CSS 变量主题令牌（冷白底 / 紫渐变 / 绿成功 / 琥珀休息 / 红中断）。
- 响应式三档：手机底部 Tab、平板顶部导航、PC 左侧边栏。
- 所有图标为**内联 SVG**（`src/components/icons.tsx`），无 emoji、无远程字体/图片。
- 弹窗有焦点圈定与 Escape；`prefers-reduced-motion` 全局降级动画；破坏性操作二次确认（清空全部需输入「清空」）。
- 加载显示骨架屏，初始化失败显示错误态 + 重试，不允许白屏。

### 6. 无云依赖

不引入 Supabase/Firebase/任何远程 API/认证。为将来可能的局域网同步预留的扩展点即 `StudyRepository` 接口本身（可新增第三个实现），本版本未实现也无需任何常驻服务。

## 目录

```text
src/
├── app/App.tsx              # 外壳：三档布局 + 四 Tab 路由 + 彩带宿主
├── components/              # ui 基础件 / feedback(弹窗·Toast) / 图标 / 进度环 / 分钟图 / 彩带
├── features/
│   ├── today/               # TodayPage / GoalCard / GoalFormDialog / CheckinDialog
│   ├── dashboard/           # DashboardPage（进度环 + 记录 + 14 天分钟图）
│   ├── weekly/              # WeeklyPage（周选择/环比/四栏/生成文本）
│   └── settings/            # SettingsPage（存储状态/导入导出/清空/PWA/关于）
├── domain/                  # 纯函数业务规则（见上）
├── storage/                 # Repository 接口 + 双实现 + 迁移 + 种子
├── state/AppData.tsx        # 全局数据层
├── styles/index.css         # Tailwind + 主题变量 + 动画
└── tests/                   # Vitest（领域/存储契约/组件）
```
