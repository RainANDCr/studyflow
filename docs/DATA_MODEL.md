# 数据模型（DATA_MODEL）

三端逻辑实体一致；Web 存 IndexedDB（Dexie），原生存 SQLite。所有「日期」为本地日历日 `YYYY-MM-DD`，所有时间戳为 ISO 字符串。

## Goal（学习目标）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| name | string | 必填，≤60 字 |
| unit | string | 自定义单位（词/页/节/课时/题…），必填，≤10 字 |
| totalAmount | number | 正数 |
| startDate | DateStr | 本地日期 |
| deadline | DateStr | ≥ startDate（Zod refine） |
| color | ColorKey | violet/emerald/blue/rose/amber/cyan |
| obstacle | string\|null | 最容易拦住我的障碍 |
| ifThenPlan | string\|null | 如果…就…（WOOP） |
| weeklyRestEnabled | boolean | 每周弹性休息日，默认 true |
| isDemo | boolean | 演示标记 |
| createdAt / updatedAt | ISO | |

## Checkin（打卡记录）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| goalId | UUID | 外键 → Goal，**删除目标级联删除打卡** |
| date | DateStr | 实际归属日历日（汇总/补记/连续/周报/推算的唯一依据，与 createdAt 无关） |
| amount | number | > 0 |
| minutes | number\|null | 未填必须为 null，绝不臆测 |
| note | string\|null | |
| isBackfill | boolean | 录入时 date < 当时今天 → true，UI 显示「补」 |
| isDemo | boolean | |
| createdAt / updatedAt | ISO | 实际录入/更新时间 |

## WeeklyReview（周复盘）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| weekStart | DateStr | 所在周周一，**唯一**（按周 upsert，不重复插入） |
| keep / problem / tryNext / nextPlan | string | 四栏：保持/问题/尝试/下周预案，≤500 字 |
| createdAt / updatedAt | ISO | |

## AppSettings（本地设置）

单行（key = `app`）：`schemaVersion`（当前 1）、`demoSeeded`、`lastSavedAt`。不存任何「同步状态」。

## 存储结构对照

**IndexedDB（Dexie `studyflow`，version 1）**

```text
goals:     id, updatedAt
checkins:  id, goalId, date, [goalId+date]
reviews:   weekStart(主键), id
settings:  key
```

升级策略：追加 `this.version(2).stores({...}).upgrade(...)`，禁止改历史版本。

**SQLite（`sqlite:studyflow.db`，PRAGMA user_version = 1）**

```sql
goals(id PK, name, unit, total_amount REAL CHECK(>0), start_date, deadline, color,
      obstacle, if_then_plan, weekly_rest_enabled INT, is_demo INT, created_at, updated_at)
checkins(id PK, goal_id REFERENCES goals(id) ON DELETE CASCADE, date, amount REAL CHECK(>0),
         minutes INT CHECK(分钟 IS NULL OR >=0), note, is_backfill INT, is_demo INT,
         created_at, updated_at)
-- 索引 idx_checkins_goal_date(goal_id, date)
weekly_reviews(id, week_start UNIQUE, keep_text, problem, try_next, next_plan, created_at, updated_at, PK(id, week_start))
app_settings(key PK, value JSON)
```

迁移：`SQLITE_MIGRATIONS[v]`（`src/storage/migrations/sqlite.ts`）按 `user_version` 逐版本执行，全程 BEGIN/COMMIT。应用层删除目标时仍显式先删 checkins（不依赖外键级联），两实现行为一致。

## 删除与导入行为

- **删除目标**：二次确认（提示将删除 N 条打卡）→ 事务内删除目标 + 其全部打卡。
- **删除打卡**：确认后删除；连续/完成率/预测/周报全部即时重算（派生值不落库）。
- **导入 JSON**：`exportPayloadSchema` 校验（app 标识 / schemaVersion / 实体结构 / 实体内字段约束）+ 文件内重复 ID 检查 + 关联完整性（goalId 必须能解析）；模式 `merge`（跳过重复 ID 与孤儿记录）或 `replace`（整库替换）；导入前自动下载当前数据快照。schemaVersion 不匹配或校验失败 → 拒绝导入，现有数据不受影响。
- **清空示例**：只删 `isDemo=true` 的目标与打卡。
- **清空全部**：输入「清空」+ 二次确认；清空后写入 `demoSeeded: true` 的设置行，防止再次播种演示数据。

## v2 新增实体（五大功能）

| 实体 | 关键字段 | 约束 |
|---|---|---|
| DailyPlan | goalId, date, plannedAmount, source(auto/manual) | goalId+date 唯一，upsert 幂等；实际量不落库 |
| Milestone | goalId, title, plannedAmount, startDate?, dueDate?, sortOrder | 删除时打卡仅置 milestoneId=null |
| MilestoneStep | milestoneId, title, isDone, doneAt?, sortOrder | 纯勾选，不参与量化 |
| Checkin.milestoneId | 可空新增 | null=未归属阶段；老数据自动归一 |
| FocusSession | goalId?, startedAt, endedAt?, plannedSeconds, focusedSeconds, status, linkedCheckinId?, pausedSeconds, lastPauseAt? | 删目标保留会话（置空归属）；删打卡同事务解除关联 |
| StudyCalendarPreference | goalId(PK), studyWeekdays[], excludedDates[], dailyCap? | 按 goal 存储，与弹性休息日独立 |

迁移：IndexedDB `version(2)`（新增 5 表 + checkins.milestoneId 索引）；SQLite `SQLITE_MIGRATIONS[1]`（5 个 CREATE TABLE + ALTER TABLE checkins ADD COLUMN）。旧库/旧 JSON(v1) 均无损兼容（导入时缺省新数组视为空、milestoneId 归一化 null）。

## 三端数据独立性

三端各自持有独立数据库（浏览器站点数据 / Windows 应用数据目录 / Android 应用私有目录），**互不同步**。迁移唯一途径：「我的」→ 导出 JSON → 另一端导入。
