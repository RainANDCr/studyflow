# 双轨进度 + 考试冲刺扩展计划（DUAL_TRACK_EXAM_EXTENSION_PLAN）

> 2026-10-26 对现有仓库的增量计划。基础版与五大功能（日历/里程碑/番茄钟/热力图/模拟器）均已实现并验证（129 测试全绿，IndexedDB v2 / SQLite v2）。本轮追加 **schema v3**。

## 一、现状审计（以实际仓库为准）

| 依赖项 | 状态 | 复用结论 |
|---|---|---|
| Goal/Checkin/WeeklyReview（内容完成率来源） | ✅ 已实现 | 完成率直接复用 `computeGoalProgress`，不重写 |
| DailyPlan（日历，plannedAmount=目标量） | ✅ 已实现 | 考试排程 plannedMinutes 是时间层，与其并列展示、**不相加** |
| Milestone（含 Checkin.milestoneId 归属） | ✅ 已实现 | KnowledgeItem.milestoneId 必须同 goal；删里程碑解绑知识点 |
| FocusSession + getEffectiveStudyMinutes（去重口径） | ✅ 已实现 | 实际投入分钟直接复用，不从掌握率/计划倒推 |
| 热力图 / 模拟器 / 周报 / streak | ✅ 已实现 | 口径不动；周报只附加「本周评估次数」小字 |
| JSON 备份 | v1/v2 导入已兼容 | 升级 v3（新实体数组可选，旧文件无损） |

## 二、新数据模型与关系

```text
Goal 1─* KnowledgeItem 1─* MasteryAssessment（评估追加式，当前掌握=最新一条投影）
Milestone 1─* KnowledgeItem（可选拥有；删除里程碑 → 置空 milestoneId）
Exam 1─* ExamGoalLink *─1 Goal（不复制目标，不改 deadline）
Exam 1─* ExamPhase（同考试日期不重叠、不越过考试日）
Exam 1─* ExamDayAvailability（examId+date 唯一；0=明确休息，缺=未规划）
Exam 1─* ExamPlanSlot（计划分钟，可锁定；同日多条）
Exam 1─* ExamReviewItem（考前重点清单；勾选≠掌握≠打卡）
GlobalStudyAvailability（date 唯一；跨考试总预算，未配置须明示）
```

字段与约束按需求文档：KnowledgeItem.weight 有限正数（默认 1，仅用于掌握覆盖率）；MasteryAssessment.rating 0–4、source 固定 'self'、追加不覆盖、可删除回算；Exam.examDate 本地 YYYY-MM-DD，已过考试停止生成新计划；ExamGoalLink 唯一 examId+goalId；ExamPlanSlot.isLocked 手动锁定；ExamDayAvailability 区分「未配置」与「0 分钟」。

## 三、迁移方案（v3，无损）

- **IndexedDB**：`version(3)` 新增 9 张表（knowledgeItems / masteryAssessments / exams / examGoalLinks / examPhases / examDayAvailabilities / globalAvailability / examPlanSlots / examReviewItems）。v1/v2 数据零改动。
- **SQLite**：`SQLITE_MIGRATIONS[2]` 追加 9 个 CREATE TABLE（外键 CASCADE 兜底 + 应用层显式清理，与现有约定一致），user_version 控制可重复执行。
- **JSON 备份 v3**：schemaVersion=3，新增 9 个数组；导入接受 1/2/3（缺省视为空）。Repository.replaceAll 增加关联校验（knowledgeItemId→同 goal 的知识点、examId 存在等），孤儿拒绝。
- **删除语义**：删目标 → 级联删知识点+评估、ExamGoalLink、该目标的 ExamPlanSlot/ExamReviewItem（考试本身保留）；删里程碑 → 知识点解绑不删；删知识点 → 二次确认（列出评估史将删除）；删考试 → 只删考试侧实体，Goal/Checkin/Milestone/FocusSession/评估全保留。

## 四、计算契约（纯函数 domain/dualTrack.ts + domain/exam.ts）

- **内容完成率**：复用 `computeGoalProgress`（Σ Checkin.amount / totalAmount，封顶 100%）。
- **掌握覆盖率**：未归档知识点权重为分母；`masteryCoverage = Σ(rating>=3 的权重)/totalWeight`；`assessmentCoverage = Σ(有评估的权重)/totalWeight`；无知识点 → 两项均 null（UI 显示「暂无掌握数据」，绝不渲染编造的 0%/100%）；有权重但全未评估 → 0% + 「全部待评估」。最新评估按 assessedAt+id 稳定排序；删除评估回算到前一条。
- **倒计时**：examDate − today 本地自然日差；考试日=0、已过=「已结束 N 天」。
- **考试排程**：分钟预算层；按 ExamGoalLink.priorityWeight 正比分配每日可用分钟；不换算成单词/页；同日合计超额警告；GlobalStudyAvailability 未配置时明示「未配置跨考试总预算」。
- **重排**：只改未来、未锁定（isLocked=false）的 generated 条目；预览差异后确认。
- 实际投入分钟沿用 FocusSession/Checkin.minutes 去重管线；未记录显示「未记录时长」。

## 五、阶段实施顺序

1. **阶段 00（本阶段）**：类型/校验/迁移/Repository/测试（不做 UI）
2. **阶段 01 双轨进度**：`domain/dualTrack.ts` 计算与测试 → 看板双轨区块 → 知识点管理弹窗 → 快速自评 → 今日摘要
3. **阶段 02 考试冲刺**：`domain/exam.ts` 算法与测试 → 今日冲刺卡 → 考试二级页（总览/阶段/时间/排程/薄弱项/清单）
4. **阶段 03**：浏览器走查（口径核对清单）→ `docs/DUAL_TRACK_EXAM_TEST_REPORT.md` → README → 门禁 → 交付报告

## 六、回归测试清单（最低）

- 旧库/旧 JSON → v3 无损；129 个既有测试保持全绿。
- 掌握率：空知识点（null）、4/3/2/未评估（50%/75%）、改评（50→75）、删除恢复、权重改变不影响 Checkin/周报。
- 倒计时：今天 0、明天 1、已过 N、跨月/跨年/闰日。
- 排程：周末 0 分钟不占、超额警告、全局预算未配置明示、isLocked 保留、幂等。
- 清单勾选不写评分/打卡；专注独立计时与关联打卡分钟不重复。
