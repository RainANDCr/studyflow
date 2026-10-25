/**
 * SQLite 迁移（Tauri 原生端）。
 * 版本号对应 PRAGMA user_version；只允许追加新版本，禁止修改历史版本语句。
 */
export const SQLITE_MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      total_amount REAL NOT NULL CHECK (total_amount > 0),
      start_date TEXT NOT NULL,
      deadline TEXT NOT NULL,
      color TEXT NOT NULL,
      obstacle TEXT,
      if_then_plan TEXT,
      weekly_rest_enabled INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      minutes INTEGER CHECK (minutes IS NULL OR minutes >= 0),
      note TEXT,
      is_backfill INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_checkins_goal_date ON checkins(goal_id, date)`,
    `CREATE TABLE IF NOT EXISTS weekly_reviews (
      id TEXT NOT NULL,
      week_start TEXT NOT NULL UNIQUE,
      keep_text TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      try_next TEXT NOT NULL DEFAULT '',
      next_plan TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, week_start)
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
  [
    // v2：五大功能（学习日历 / 里程碑 / 番茄钟 / 热力图口径 / 计划模拟器）
    `CREATE TABLE IF NOT EXISTS daily_plans (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      planned_amount REAL NOT NULL CHECK (planned_amount > 0),
      source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (goal_id, date)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_daily_plans_goal ON daily_plans(goal_id, date)`,
    `CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      planned_amount REAL NOT NULL CHECK (planned_amount > 0),
      start_date TEXT,
      due_date TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_milestones_goal ON milestones(goal_id, sort_order)`,
    `CREATE TABLE IF NOT EXISTS milestone_steps (
      id TEXT PRIMARY KEY,
      milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_steps_milestone ON milestone_steps(milestone_id, sort_order)`,
    `ALTER TABLE checkins ADD COLUMN milestone_id TEXT`,
    `CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      goal_id TEXT,
      milestone_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      planned_seconds INTEGER NOT NULL CHECK (planned_seconds > 0),
      focused_seconds INTEGER NOT NULL DEFAULT 0 CHECK (focused_seconds >= 0),
      status TEXT NOT NULL CHECK (status IN ('active','completed','interrupted','abandoned')),
      linked_checkin_id TEXT,
      paused_seconds INTEGER NOT NULL DEFAULT 0,
      last_pause_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_started ON focus_sessions(started_at)`,
    `CREATE TABLE IF NOT EXISTS calendar_prefs (
      goal_id TEXT PRIMARY KEY,
      study_weekdays TEXT NOT NULL,
      excluded_dates TEXT NOT NULL,
      daily_cap INTEGER
    )`,
  ],
  [
    // v3：双轨进度 + 考试冲刺
    `CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      milestone_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      weight REAL NOT NULL CHECK (weight > 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_goal ON knowledge_items(goal_id, sort_order)`,
    `CREATE TABLE IF NOT EXISTS mastery_assessments (
      id TEXT PRIMARY KEY,
      knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 4),
      assessed_at TEXT NOT NULL,
      local_date TEXT NOT NULL,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'self',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_assess_item ON mastery_assessments(knowledge_item_id, assessed_at)`,
    `CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      exam_time TEXT,
      start_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS exam_goal_links (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      priority_weight REAL NOT NULL CHECK (priority_weight > 0),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (exam_id, goal_id)
    )`,
    `CREATE TABLE IF NOT EXISTS exam_phases (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      focus_note TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS exam_day_availability (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      available_minutes INTEGER NOT NULL CHECK (available_minutes >= 0),
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','generated')),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (exam_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS global_availability (
      date TEXT PRIMARY KEY,
      available_minutes INTEGER NOT NULL CHECK (available_minutes >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS exam_plan_slots (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      planned_minutes INTEGER NOT NULL CHECK (planned_minutes >= 0),
      title TEXT,
      knowledge_item_id TEXT,
      phase_id TEXT,
      source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('manual','generated')),
      is_locked INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_slots_exam_date ON exam_plan_slots(exam_id, date)`,
    `CREATE TABLE IF NOT EXISTS exam_review_items (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      knowledge_item_id TEXT,
      goal_id TEXT,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
      done_at TEXT,
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
  [
    // v4：11 项通用功能（生命周期/预算/估时/修订/随记/断点/报告）
    `CREATE TABLE IF NOT EXISTS goal_lifecycles (
      goal_id TEXT PRIMARY KEY,
      manual_status TEXT NOT NULL DEFAULT 'active' CHECK (manual_status IN ('active','paused','cancelled','archived')),
      note TEXT,
      paused_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS goal_status_events (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      reason TEXT,
      occurred_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS weekly_availability (
      weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7),
      available_minutes INTEGER NOT NULL CHECK (available_minutes >= 0),
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS availability_exceptions (
      date TEXT PRIMARY KEY,
      available_minutes INTEGER NOT NULL CHECK (available_minutes >= 0),
      reason TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS goal_plan_policies (
      goal_id TEXT PRIMARY KEY,
      priority INTEGER NOT NULL DEFAULT 0,
      minutes_per_unit REAL,
      estimate_source TEXT CHECK (estimate_source IN ('manual','derived') OR estimate_source IS NULL),
      estimate_sample_count INTEGER,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS plan_revisions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      trigger TEXT NOT NULL,
      reason TEXT,
      diff_summary TEXT NOT NULL,
      undo_snapshot TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS study_notes (
      id TEXT PRIMARY KEY,
      goal_id TEXT,
      date TEXT NOT NULL,
      body TEXT NOT NULL,
      mood TEXT CHECK (mood IN ('进展','困难','调整','其他') OR mood IS NULL),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notes_goal_date ON study_notes(goal_id, date)`,
    `CREATE TABLE IF NOT EXISTS study_resume_points (
      goal_id TEXT PRIMARY KEY,
      last_position TEXT,
      next_action TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS study_reports (
      id TEXT PRIMARY KEY,
      period_type TEXT NOT NULL CHECK (period_type IN ('month','quarter','year')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
]
