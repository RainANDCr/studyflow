# 11 项通用功能审计（GENERIC_EXTENSION_AUDIT）

> 2026-10-26 以真实仓库为准的盘点。基线：v3 schema（129→160 测试全绿），已有 Goal/Checkin/WeeklyReview/DailyPlan/Milestone/Step/FocusSession/双轨/考试体系。

## 一、逐项现状

| # | 功能 | 现状 | 可复用模块 | 本轮增量 |
|---|---|---|---|---|
| 13 | 目标生命周期 | **不存在** | goalSortWeight/已完成推导（progress.ts） | GoalLifecycle+事件表、effectiveStatus、今日筛选、卡片菜单 |
| 2 | 每周时间预算 | **部分**（考试侧 ExamDayAvailability 已有按日期分钟概念；无全局周预算） | getEffectiveStudyMinutes | WeeklyAvailability+例外表、预算周视图 |
| 4 | 自适应计划重排 | **大部分**（distributeRemaining/buildReschedulePreview/applyDailyPlanChanges 事务已实现） | 全部复用 | needsReschedule 触发卡、PlanRevision 修订记录+撤销 |
| 5 | 一键开始学习 | **大部分**（FocusPanel：选目标/预设/暂停继续/结束/保存专注或关联打卡/重启恢复） | FocusPanel 全部 | GoalCard「开始」直达（initialGoalId 已支持）、记住上次模式 |
| 6 | 断点续接 | **不存在** | — | StudyResumePoint（每目标一条）+ 详情/今日卡/结束页填写 |
| 7 | 极速打卡与批量 | **部分**（打卡弹窗预填建议量/补记 6 天规则） | checkinInputSchema/补记规则 | 卡片一键记建议量+撤销、批量表格（原子） |
| 8 | 学习随记 | **不存在** | — | StudyNote（可关联 goal/date）+ 详情时间线 |
| 9 | 效率分析中心 | **部分**（热力图/14天图/统计纯函数） | getEffectiveStudyMinutes/compareWeeks | 分析中心视图（投入/兑现率/单位时间产出/趋势） |
| 11 | 计划与实际对比 | **部分**（日历抽屉已显示计划X/实际Y） | getDayPlanStatus | 周/月对比视图（按目标分组不跨单位求和） |
| 12 | 长期报告 | **不存在** | summarizeRange/getMasteryStats | StudyReport 快照（月/季/年）+ Markdown 导出 |
| 15 | 个性化工作台 | **部分**（主题三态已实现） | theme.ts | 卡片显隐/排序/密度（localStorage 本机偏好） |

## 二、口径红线（沿用并写入测试）

- Checkin.amount 是完成量唯一权威；计划/计时/随记不得自动加量。
- 今日建议量（旧算法）≠ 日历计划量；两者 UI 分开标注（已实现，保持）。
- minutes=null 是未知不是 0；FocusSession 与 Checkin 关联时分钟只计一次（getEffectiveStudyMinutes 唯一实现）。
- 生命周期 manualStatus 与「completed 由进度推导」分离；删除打卡自动回算。
- 预算的「每周弹性休息日」≠ 用户固定休息日（两套规则既有事实，保持）。

## 三、v4 新增实体（一次迁移）

goalLifecycles(goalId PK) / goalStatusEvents(id) / weeklyAvailability(weekday PK 1-7) / availabilityExceptions(date PK) / goalPlanPolicies(goalId PK：priority、minutesPerUnit?、estimateSource manual|derived) / planRevisions(id, undoSnapshot) / studyNotes(id) / studyResumePoints(goalId PK) / studyReports(id)。DashboardPreferences（卡片显隐/排序/密度）与「记住上次专注模式」存 localStorage（本机偏好，无远程语义），文档说明。

迁移：IndexedDB version(4)；SQLite `SQLITE_MIGRATIONS[3]`；JSON 备份 v4（导入兼容 1/2/3）。旧数据零改动、默认 lifecycle=active、不伪造历史事件。

## 四、冲突与决策

- 已完成推导 vs lifecycle：`effectiveStatus = manualStatus==='active' && derived-completed ? 'completed' : manualStatus`；暂停目标不进自动排程与今日待办（streak 历史算法不动）。
- 重排触发只提示不自动写；应用走既有事务 + PlanRevision 快照，撤销校验后续无人工修改。
- 批量打卡沿用「最多最近 6 个过去日+今天」，不放宽；同天多次合法，按幂等 token 防重复提交。

## 五、风险

低-中：全部为增量表与二级视图；129+31 个既有用例为回归底线。构建：EXE/APK 本机无工具链 → 交付 GitHub Actions 云构建工作流（push tag 产出 Release），如实标注「本机未验证，云端待推送触发」。
