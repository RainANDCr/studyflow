/// 知行 StudyFlow 桌面/移动入口。
/// 数据层全部在前端 TypeScript（StudyRepository 适配器）中，
/// 原生侧只负责窗口与 SQLite 插件（tauri-plugin-sql，数据库文件在应用私有目录）。
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
