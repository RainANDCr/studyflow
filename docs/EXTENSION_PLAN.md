# 五大功能扩展计划（EXTENSION_PLAN）

> 基于 2026-10-25 对现有 StudyFlow 代码的审计制定。原则：**最小增量、无损迁移、单一事实来源不破坏**。

## 一、现有资产盘点（审计结论）

| 资产 | 位置 | 复用结论 |
|---|---|---|
| Goal / Checkin / WeeklyReview / AppSettings | `src/domain/types.ts` | 语义不变；Checkin 仅**新增可空字段** `milestoneId` |
| StudyRepository 接口 + IndexedDB / SQLite 双实现 | `src/storage/` | 扩展方法，不推倒 |
| IndexedDB schema v1（goals/checkins/reviews/settings） | `indexeddb.ts` | 追加 `version(2)` 升级 |
| SQLite 迁移（PRAGMA user_version=1，4 表） | `migrations/sqlite.ts` | 追加 v2 迁移块 |
| 领域纯函数（dates/progress/suggestion/prediction/streak/weekly） | `src/domain/` | 全部保留为「推荐量/实际速度」口径；新功能平行新增函数 |
| 今日建议量、连续+休息日、近 7 天预测、周报环比 | 同上 | **禁止修改既有口径**；日历「当日安排量」是独立数值 |
| JSON 导入导出 | `validation.ts` + `replaceAll` | 升级为 v2，**兼容导入 v1 旧文件** |
| 62 个测试 | `src/tests/` | 保持全绿；新增测试只增不改断言（除明确口径升级处） |

## 二、新增数据结构（最小字段原则）

| 实体 | 字段 | 关键约束 |
|---|---|---|
| **DailyPlan** | id, goalId, date, plannedAmount, source('auto'\|'manual'), createdAt, updatedAt | 唯一逻辑键 goalId+date；重复保存=幂等更新；当日实际量从 Checkin 动态聚合，**不落库** |
| **Milestone** | id, goalId, title, plannedAmount(>0), startDate?, dueDate?, sortOrder, color?, createdAt, updatedAt | 必须指向存在的 Goal；阶段量允许未分完，超出总量必须显式提示 |
| **MilestoneStep** | id, milestoneId, title, isDone, doneAt?, sortOrder | 纯勾选清单，**不参与任何量化进度** |
| **Checkin.milestoneId** | 新增可空 | 老记录 null=「未归属阶段」，总进度不受影响；必须同 goalId 下 |
| **FocusSession** | id, goalId?, milestoneId?, startedAt, endedAt?, plannedSeconds(>0), focusedSeconds(≥0), status('active'\|'completed'\|'interrupted'\|'abandoned'), linkedCheckinId?, pausedSeconds, lastPauseAt?, createdAt, updatedAt | 内部统一存秒；暂停累计与最后恢复点持久化，恢复计时按 Date.now 差值推算，不依赖 setInterval |
| **StudyCalendarPreference** | goalId(PK), studyWeekdays(1–7, 周一=1), excludedDates[], dailyCap? | 按 goal 存储；与「每周弹性休息日」是两套独立规则 |

## 三、存储迁移方案（无损）

- **IndexedDB**：`version(2)` 新增 5 张表（dailyPlans / milestones / milestoneSteps / focusSessions / calendarPrefs），checkins 增加 `milestoneId` 索引；旧数据不动，缺字段读取时归一化为 null。
- **SQLite**：v2 迁移块 = 5 个 CREATE TABLE + `ALTER TABLE checkins ADD COLUMN milestone_id`；可重复执行（IF NOT EXISTS 语义 + user_version 控制）；外键 ON DELETE CASCADE 兜底 + 应用层显式清理。
- **JSON 备份 v2**：schemaVersion=2，新增 5 个数组字段；导入接受 v1（缺数组视为空）与 v2；校验关联 ID（plan/milestone/step 的 goalId、checkin.milestoneId 同目标、session.linkedCheckinId 存在）。
- **删除语义**：删目标 → 级联删 DailyPlan / Milestone（连带 Step），FocusSession **保留**但 goalId/milestoneId 置空（专注历史不丢）；删 Checkin → 同事务解除 FocusSession.linkedCheckinId；删 Milestone → 关联 Checkin 仅置 milestoneId=null，**绝不级联删打卡**。
- **清空演示**：扩展到全部新实体中 isDemo 数据；**清空全部**保持输入「清空」确认。

## 四、统一统计口径（全功能共用）

- `getEffectiveStudyMinutes(checkins, sessions)`：填写的 Checkin.minutes + **未关联 Checkin** 的 FocusSession 有效分钟；已关联的会话经 Checkin.minutes 统计一次，绝不双计；跨午夜会话按本地日历日拆分（绝对时间戳映射）。周报与 14 天图与热力图共用。
- Goal 进度=Σ Checkin.amount；里程碑进度=Σ 指向它的 Checkin.amount；连续天数/休息日/预测按旧函数。
- 模拟器结果=用户假设推演，与「近 7 天实际速度预测」严格区分标签。

## 五、开发顺序与依赖

1. **阶段0**：本文件 + 类型/校验/迁移/接口扩展 + 升级测试（后续一切的前提）
2. **阶段1 日历**：依赖 DailyPlan 表。引擎纯函数 → CalendarView UI（月/周/日详情/拖拽改期/自动排程预览）
3. **阶段2 里程碑**：依赖 Milestone 表与 Checkin.milestoneId。拆分器 → 详情 UI + 打卡弹窗关联 + 未分配区
4. **阶段3 番茄钟**：依赖 FocusSession 表与有效分钟函数。状态机 → 专注面板 + 恢复 + 关联打卡
5. **阶段4 热力图**：依赖有效分钟函数。纯聚合 → 看板卡片
6. **阶段5 模拟器**：依赖日历（应用到计划）但计算独立。纯函数 → 模拟弹窗
7. **阶段6 联调**：口径统一复查、导入导出全链路、四 Tab 回归、文档、三端构建状态如实报告

## 六、兼容风险与对策

| 风险 | 对策 |
|---|---|
| 旧库升级丢数据 | IndexedDB 仅加表加索引；SQLite ALTER ADD COLUMN 可空；升级测试用「v1 旧 schema 建库 → v2 打开」验证 |
| 旧 JSON 文件导入失败 | v1 payload 接受路径：缺省新数组=空；导入前后快照机制保留 |
| 周报/14天图分钟口径变化 | 统一为有效分钟；无专注会话时数值与旧版一致（测试保证） |
| 双重计算（计划≠完成、专注≠数量） | 计划量与实际量分字段展示；FocusSession 与 Checkin 关联去重由单一函数保证 |
| 今日页臃肿 | 五功能均为二级视图/弹窗/卡片内分区；不新增主 Tab |

## 七、回归测试计划

- 既有 62 测试全绿（存储契约测试扩展新实体后仍含原用例）。
- 每阶段新增领域单测 + 存储契约测试；阶段6 增加跨模块联动测试（打卡→日历/里程碑/热力图/周报同步刷新口径）。
- 每阶段门禁：`typecheck / lint / test / build` 全绿后进入下一阶段。
- Windows/Android：本机无 Rust/Android SDK，保持「配置就绪、未验证」如实标注，不虚报产物。
