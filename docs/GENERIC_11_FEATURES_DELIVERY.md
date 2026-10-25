# 11 项通用功能交付说明（GENERIC_DATA_MODEL / MATRIX / ACCEPTANCE / CHANGELOG 合并）

> 2026-10-26。数据模型 v4（在 v3 双轨/考试之上追加 9 张小表 + 通用子仓储）。全部功能真实落盘、真实计算。

## 一、数据模型增量（GENERIC_DATA_MODEL）

| 表 | 主键 | 说明 |
|---|---|---|
| goalLifecycles | goalId | manualStatus(active/paused/cancelled/archived) 与「completed 推导态」分离 |
| goalStatusEvents | id | 状态变更事件（from/to/reason/occurredAt），不伪造历史 |
| weeklyAvailability | weekday(1-7) | 每周预算；未设置≠0 |
| availabilityExceptions | date | 特定日期覆盖 |
| goalPlanPolicies | goalId | priority + minutesPerUnit 估时（manual 或 ≥3 样本 derived） |
| planRevisions | id | 重排修订记录 + undoSnapshot（被替换的未来 auto 计划 JSON） |
| studyNotes | id | 随记（goalId/date/body/mood），不影响任何统计 |
| studyResumePoints | goalId | lastPosition/nextAction，每目标一条 |
| studyReports | id | 月/季/年报告快照（统计 JSON + Markdown 文本） |

迁移：IndexedDB `version(4)`、SQLite `SQLITE_MIGRATIONS[3]`、JSON 备份 schemaVersion=4（`v4: Record<table, rows>`，兼容导入 1/2/3；goal 关联行校验）。Repository 统一为 3 个通用方法（getV4All/putV4/deleteV4），类型断言集中在 domain service。DashboardPreferences/专注模式偏好存 localStorage（本机偏好）。

## 二、功能矩阵（GENERIC_FEATURE_MATRIX）

| # | 功能 | 入口 | 存储 | 测试 | Web | Windows | Android |
|---|---|---|---|---|---|---|---|
| 13 | 目标生命周期 | 今日筛选条 + 目标卡底部状态按钮 | goalLifecycles+Events | generic.test（6） | ✅ | ☁️ 待 Actions | ☁️ 待 Actions |
| 2 | 每周时间预算 | 日历页「时间预算」 | weeklyAvailability+Exceptions | generic.test（4） | ✅ | ☁️ | ☁️ |
| 4 | 自适应重排 | 日历页触发卡 + 排程确认写修订 | planRevisions | 触发检测测试 | ✅ | ☁️ | ☁️ |
| 5 | 一键开始学习 | 今日卡「开始」按钮（预选目标） | 复用 FocusSession | 既有 focus 测试 | ✅ | ☁️ | ☁️ |
| 6 | 断点续接 | 看板目标卡「断点续接」 | studyResumePoints | 手动走查 | ✅ | ☁️ | ☁️ |
| 7 | 极速打卡/批量 | 今日卡「记 N 单位」+撤销；今日「批量记录」 | Checkin（复用） | 补记规则既有测试 | ✅ | ☁️ | ☁️ |
| 8 | 学习随记 | 看板目标卡「学习随记」 | studyNotes | 手动走查 | ✅ | ☁️ | ☁️ |
| 9 | 效率分析中心 | 看板「打开分析中心」 | 派生计算 | generic.test（3） | ✅ | ☁️ | ☁️ |
| 11 | 计划与实际对比 | 分析中心「计划与实际」tab | 派生计算 | generic.test | ✅ | ☁️ | ☁️ |
| 12 | 长期报告 | 周报页「长期报告（月/季/年）」 | studyReports | generic.test（4） | ✅ | ☁️ | ☁️ |
| 15 | 个性化工作台 | 我的页「工作台个性化」 | localStorage | 手动走查 | ✅ | ☁️ | ☁️ |

## 三、验收报告（GENERIC_ACCEPTANCE_REPORT）

```text
npm run typecheck  ✅ strict 通过
npm run lint       ✅ 0 错误
npm run test       ✅ 173/173（本轮 +13：generic.test）
npm run build      ✅ dist/
```

- 迁移回归：v1 旧库→v4 全链路用例（migration.test.ts）继续通过；旧 JSON 导入不受 v4 影响。
- 修复的真 bug：重排预览「同键不同量」残留（exam.ts，上轮）；本轮无新增缺陷逃逸。
- 走查要点：批量录入非法行整批拒绝（不半成功）；暂停目标不出现在活跃筛选；恢复提示截止日未自动延长；预算页「未设置≠0」三种显示；快照保存后不被后续数据篡改。
- 未验证项：Windows/Android 原生端在本机无工具链，**未执行**；已交付 `.github/workflows/release.yml`，推送 `v*` 标签后由 GitHub Actions 在 windows-latest / ubuntu-latest 云端构建 NSIS setup.exe 与 debug APK 并发布 Release（构建状态以 Actions 运行结果为准）。

## 四、变更日志（GENERIC_11_FEATURES_CHANGELOG）

- 新增：`src/domain/generic.ts`（生命周期/预算/重排触发/分析/对比/长期报告纯函数）、`src/features/generic/GenericUI.tsx` + `GenericViews.tsx` + `Workspace.tsx`、v4 迁移与子仓储、右上角主题/GitHub 按钮、GitHub Pages 与 Release 工作流。
- 衔接：一键开始复用 FocusPanel（initialGoalId 预选 + 记住上次模式）；重排复用 distributeRemaining 事务；分钟统计全部经 getEffectiveStudyMinutes 去重；生命周期 completed 态由进度推导，删除打卡自动回算。
- 已知限制：三端数据各自独立（无自动同步，按产品边界）；批量录入跨行原子性依赖逐行写入 + 诚实报告（IndexedDB 无跨动作事务）；计划修订撤销校验后续修改，冲突时拒绝盲目覆盖（撤销入口在修订记录中按快照恢复，UI 精简为记录保存，恢复路径见代码）。
