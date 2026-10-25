# 知行 StudyFlow

> 把终点变成今天的一小步 —— 本地离线的学习目标管理应用（Web + Windows + Android）。

- **Web**：浏览器直接运行，数据保存在 IndexedDB（Dexie），刷新/重启浏览器后仍在。
- **Windows**：Tauri 2 打包，本机 SQLite，NSIS `setup.exe` 安装包。
- **Android**：同一 Tauri 2 工程，APK 安装，应用私有目录 SQLite，离线可用。

**无账号、无登录、无云端服务器、不上传任何数据。** 三端各自本地保存，是三个独立的数据空间；跨端迁移通过「我的 → 导出/导入 JSON」手动完成。本版本不提供也不宣传任何在线同步。

## 快速开始（Web）

```bash
npm install
npm run dev        # http://localhost:5173
```

其他命令：

```bash
npm run build      # 产出静态前端 dist/
npm run preview    # 本地预览 dist/
npm run typecheck  # TypeScript 严格检查
npm run lint       # ESLint
npm run test       # Vitest 单元测试（62 个用例）
npm run icon       # 重新生成应用图标（脚本 + tauri icon）
```

## Windows / Android

完整环境准备与构建步骤见：

- [docs/BUILD_WINDOWS.md](docs/BUILD_WINDOWS.md)（需要 Rust / MSVC / WebView2；产出 NSIS setup.exe）
- [docs/BUILD_ANDROID.md](docs/BUILD_ANDROID.md)（需要 Android Studio / SDK / NDK / JDK；产出 debug / release APK）

```bash
npm run tauri dev            # 桌面开发运行
npm run tauri build          # Windows NSIS 安装包
npm run tauri android init   # 初始化 Android 工程
npm run tauri android dev    # 连接真机/模拟器运行
npm run tauri android build -- --apk   # APK
```

## 功能一览

- **今日**：目标卡直接打卡（数量预填今日建议量、分钟选填、最近 6 天补记、备注）；逾期双出口（立即打卡/调整计划）；昨日漏卡黄卡（弹性休息日宽免）/红卡（连续中断）置顶提示；首次完成目标触发彩带。
- **看板**：SVG 进度环、完成率/连续天数/预计完成日、障碍与 if-then 预案、最近 10 条记录（可删除）、近 14 天分目标分钟堆叠柱状图（自绘 SVG，只统计明确填写的分钟数）。
- **周报**：周选择器（禁止未来周）、分目标完成量（保留单位、不跨单位加总）、与上周同口径环比（本周进行中只比周一至当前星期几）、四栏复盘（保持/问题/尝试/下周预案）、一键生成并复制中文周报文本。
- **我的**：本地存储状态（存储方式/最近成功写入时间/记录数量）、重新读取本地数据、JSON 导出/导入（校验 schemaVersion、重复 ID、关联完整性；导入前自动快照）、清空示例/清空全部（输入「清空」二次确认）、Web 端 PWA 安装说明。

## 五大新功能（v2）

- **智能学习日历**（今日页 → 日历视图）：计划 vs 实际逐日对照、商余数自动排程（手动锁定保留）、拖拽/键盘改期、按目标学习星期与排除日设置。
- **目标拆分与里程碑**（看板目标卡内）：有序阶段 + 三种本地拆分入口 + 打卡可选关联阶段 + 未分配记录批量归属 + 小步骤清单。
- **番茄钟专注模式**（今日页 → 开始专注）：墙钟差值计时、重启恢复三选一、专注记录与打卡可选关联、有效分钟去重口径。
- **学习数据热力图**（看板下方）：近 12 个月 5 档紫色梯度，有效分钟/打卡活跃度双口径，点击查看当日详情。
- **计划模拟器**（看板目标卡 → 模拟）：假设推演完成日 + SVG 累计曲线（实线历史/虚线假设），确认后仅写日历计划，不碰打卡与截止日。

统一口径：**主目标进度=Σ打卡；阶段进度=Σ关联打卡；有效分钟=填写打卡分钟+未关联打卡的专注会话**（全图表共用）。详见 [docs/NEW_FEATURES_GUIDE.md](docs/NEW_FEATURES_GUIDE.md) 与 [docs/EXTENSION_PLAN.md](docs/EXTENSION_PLAN.md)。

## 双轨进度 + 考试冲刺（v3）

- **双轨学习进度**（看板目标卡内）：内容完成率（打卡量，紫）× 知识掌握覆盖率（真实自评，绿）。知识点管理支持批量粘贴、权重、里程碑归属、归档；5 级自评（0 完全不会 → 4 熟练迁移）追加式历史、可删除回算。无知识点显示「暂无掌握数据」，绝不编造 0%/100%。
- **考试冲刺模式**（今日页 → 考试冲刺）：考试档案与本地日倒计时、关联多个目标（权重份额）、备考阶段（草案生成+冲突检测）、每日可用时间（未配置≠0 分钟）、按权重正比生成分钟预算排程（锁定保留、超额与全局预算校验）、薄弱项队列（按自评排序、理由可解释）、考前重点清单（勾选不改评分）。
- 口径铁律：**内容完成率=Σ打卡；掌握覆盖率=自评权重投影；排程分钟≠目标量≠实际分钟**（三层并列不相加）。详见 [docs/DUAL_TRACK_EXAM_EXTENSION_PLAN.md](docs/DUAL_TRACK_EXAM_EXTENSION_PLAN.md) 与 [docs/DUAL_TRACK_EXAM_TEST_REPORT.md](docs/DUAL_TRACK_EXAM_TEST_REPORT.md)。

## 业务规则（摘要）

全部规则以纯函数实现于 `src/domain/`，并有对应测试（`src/tests/`）：

- **今日建议量** = ⌈剩余量 ÷ 剩余天数⌉（截止日含今天）；已完成为 0；逾期显示「已逾期 X 天」并给滚入今日量，绝不除以 0。
- **近 7 天预测**：以今天为终点的 7 个日历日窗口（按目标开始日截断），至少 3 个不同有效打卡日且平均速度为正才输出；预计完成日按「今天算第 1 天」推算；已完成用实际完成日。
- **连续打卡**：一周 = 周一至周日；启用弹性休息日时每周宽免 1 个缺卡日，第二个缺卡日打断连续；每周额度独立不累计；今天未结束不算漏卡；缺卡判定止于目标完成日。
- **周报环比**：本周未结束时与上一周同日数窗口比较；上期为 0 显示「上期为 0 / 本期新增」，两期皆 0 显示「持平」。
- **日期**：一切「今天/昨天/周一」按设备本地时区；日历日期 `YYYY-MM-DD`，不经 UTC 转换。

## 架构与数据模型

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)。

## 验收清单

见 [docs/FEATURE_CHECKLIST.md](docs/FEATURE_CHECKLIST.md)（含功能—平台—验证方式—状态表）。

## 许可与隐私

本应用完全离线运行，不收集、不上传任何个人数据。© 2026 知行 StudyFlow
