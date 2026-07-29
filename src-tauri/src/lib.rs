mod database;
mod files;
mod licensing;
mod mikrotik;
mod printing;
mod wireguard;

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
            database::db_backup,
            database::db_list_backups,
            database::db_transaction,
            database::db_query,
            database::db_restore,
            files::file_metadata,
            files::file_open,
            files::file_remove,
            files::file_reveal,
            files::file_export_to_downloads,
            files::file_write_bytes,
            licensing::license_get_device_identity,
            licensing::license_protect_value,
            licensing::license_sign_device_payload,
            licensing::license_unprotect_value,
            mikrotik::mikrotik_api_call,
            printing::print_file,
            printing::print_list_printers,
            wireguard::wireguard_available,
            wireguard::wireguard_install,
            wireguard::wireguard_tunnel_down,
            wireguard::wireguard_tunnel_up
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
