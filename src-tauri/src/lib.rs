mod database;
mod mikrotik;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            database::initialize_database(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database::db_initialize,
            database::db_execute,
            database::db_query,
            mikrotik::mikrotik_api_call
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
