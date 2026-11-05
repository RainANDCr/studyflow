/// 知行 StudyFlow 桌面/移动入口。
/// 数据层全部在前端 TypeScript（StudyRepository 适配器）中，
/// 原生侧只负责窗口与 SQLite 插件（tauri-plugin-sql，数据库文件在应用私有目录）。
/// mobile_entry_point 为 Android/iOS 生成必需的导出符号（桌面构建会忽略该属性）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![import_sqlite_batch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
use serde_json::Value;
use tauri_plugin_sql::{DbInstances, DbPool};

#[tauri::command]
async fn import_sqlite_batch(
    instances: tauri::State<'_, DbInstances>,
    db: String,
    statements: Vec<(String, Vec<Value>)>,
) -> Result<(), String> {
    let pool = {
        let instances = instances.0.read().await;
        match instances.get(&db) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("SQLite 数据库尚未初始化".into()),
        }
    };
    let mut transaction = pool.begin().await.map_err(|err| err.to_string())?;
    for (sql, values) in statements {
        let mut query = sqlx::query(&sql);
        for value in values {
            query = match value {
                Value::Null => query.bind(None::<String>),
                Value::String(value) => query.bind(value),
                Value::Number(value) => query.bind(value.as_f64()),
                value => query.bind(value),
            };
        }
        query.execute(&mut *transaction).await.map_err(|err| err.to_string())?;
    }
    transaction.commit().await.map_err(|err| err.to_string())
}

