use rusqlite::types::Value as SqliteValue;
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "initial_schema",
        include_str!("../migrations/001_initial_schema.sql"),
    ),
    (
        2,
        "demo_seed",
        include_str!("../migrations/002_demo_seed.sql"),
    ),
    (
        3,
        "accounts_profiles_subscriptions",
        include_str!("../migrations/003_accounts_profiles_subscriptions.sql"),
    ),
    (
        4,
        "subscription_pricing_grid",
        include_str!("../migrations/004_subscription_pricing_grid.sql"),
    ),
    (
        5,
        "invoices_permission",
        include_str!("../migrations/005_invoices_permission.sql"),
    ),
    (
        6,
        "profile_id_audit_fields",
        include_str!("../migrations/006_profile_id_audit_fields.sql"),
    ),
    (
        7,
        "internal_profile_permissions_v2",
        include_str!("../migrations/007_internal_profile_permissions_v2.sql"),
    ),
    (
        8,
        "account_profile_activity_scope",
        include_str!("../migrations/008_account_profile_activity_scope.sql"),
    ),
    (
        9,
        "canonical_account_profile_identity",
        include_str!("../migrations/009_canonical_account_profile_identity.sql"),
    ),
    (
        10,
        "router_notes",
        include_str!("../migrations/010_router_notes.sql"),
    ),
    (
        11,
        "print_history",
        include_str!("../migrations/011_print_history.sql"),
    ),
    (
        12,
        "vpn_networks_peers",
        include_str!("../migrations/012_vpn_networks_peers.sql"),
    ),
    (
        13,
        "vpn_permission",
        include_str!("../migrations/013_vpn_permission.sql"),
    ),
    (
        14,
        "vpn_hub_provisioning",
        include_str!("../migrations/014_vpn_hub_provisioning.sql"),
    ),
    (
        15,
        "license_state",
        include_str!("../migrations/015_license_state.sql"),
    ),
    (
        16,
        "license_multi_device_plan",
        include_str!("../migrations/016_license_multi_device_plan.sql"),
    ),
    (
        17,
        "disable_legacy_demo_account",
        include_str!("../migrations/017_disable_legacy_demo_account.sql"),
    ),
    (
        18,
        "restore_vpn_connection_modes",
        include_str!("../migrations/018_restore_vpn_connection_modes.sql"),
    ),
    (
        19,
        "ticket_router_username_uniqueness",
        include_str!("../migrations/019_ticket_router_username_uniqueness.sql"),
    ),
    (
        20,
        "router_hotspot_address",
        include_str!("../migrations/020_router_hotspot_address.sql"),
    ),
    (
        21,
        "generated_file_metadata",
        include_str!("../migrations/021_generated_file_metadata.sql"),
    ),
    (
        22,
        "vpn_peer_lifecycle",
        include_str!("../migrations/022_vpn_peer_lifecycle.sql"),
    ),
    (
        23,
        "ticket_runtime_tracking",
        include_str!("../migrations/023_ticket_runtime_tracking.sql"),
    ),
];

const DATABASE_FILE_NAME: &str = "hotspot-manager.sqlite";
const BACKUPS_DIRECTORY: &str = "backups";
const LEGACY_IDENTIFIER: &str = "com.local.hotspotmanager";

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum DbParam {
    Null,
    Text(String),
    Integer(i64),
    Float(f64),
    Bool(bool),
}

#[derive(Debug, Clone, Serialize)]
pub struct DbExecuteResult {
    pub rows_affected: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DbStatement {
    pub sql: String,
    pub params: Vec<DbParam>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseBackup {
    pub absolute_path: String,
    pub file_name: String,
    pub size_bytes: u64,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    Ok(data_dir.join(DATABASE_FILE_NAME))
}

fn backups_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let directory = data_dir.join(BACKUPS_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn backup_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let path = Path::new(file_name);
    if file_name.trim().is_empty()
        || path.is_absolute()
        || path.components().count() != 1
        || path.extension().and_then(|value| value.to_str()) != Some("sqlite")
    {
        return Err("Nom de sauvegarde invalide.".to_string());
    }

    Ok(backups_directory(app)?.join(path))
}

fn legacy_sibling_directory(current: &Path) -> Option<PathBuf> {
    current
        .parent()
        .map(|parent| parent.join(LEGACY_IDENTIFIER))
}

fn copy_if_missing(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() || target.exists() {
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::copy(source, target).map_err(|error| error.to_string())?;
    Ok(())
}

fn copy_directory_if_missing(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(target).map_err(|error| error.to_string())?;

    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_if_missing(&source_path, &target_path)?;
        } else {
            copy_if_missing(&source_path, &target_path)?;
        }
    }

    Ok(())
}

fn migrate_legacy_storage(app: &AppHandle) -> Result<(), String> {
    let current_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    if let Some(legacy_data_dir) = legacy_sibling_directory(&current_data_dir) {
        for suffix in ["", "-wal", "-shm"] {
            let file_name = format!("{DATABASE_FILE_NAME}{suffix}");
            copy_if_missing(
                &legacy_data_dir.join(&file_name),
                &current_data_dir.join(&file_name),
            )?;
        }
    }

    // Le profil WebView contient notamment localStorage et les sessions locales.
    // Sa copie est une migration unique et n'écrase jamais les fichiers TicketPro existants.
    if let Ok(current_local_data_dir) = app.path().app_local_data_dir() {
        if let Some(legacy_local_data_dir) = legacy_sibling_directory(&current_local_data_dir) {
            let _ = copy_directory_if_missing(&legacy_local_data_dir, &current_local_data_dir);
        }
    }

    Ok(())
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?).map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn db_param_to_sqlite_value(param: DbParam) -> SqliteValue {
    match param {
        DbParam::Null => SqliteValue::Null,
        DbParam::Text(value) => SqliteValue::Text(value),
        DbParam::Integer(value) => SqliteValue::Integer(value),
        DbParam::Float(value) => SqliteValue::Real(value),
        DbParam::Bool(value) => SqliteValue::Integer(if value { 1 } else { 0 }),
    }
}

fn sqlite_value_to_json(value: SqliteValue) -> Value {
    match value {
        SqliteValue::Null => Value::Null,
        SqliteValue::Integer(value) => Value::from(value),
        SqliteValue::Real(value) => Value::from(value),
        SqliteValue::Text(value) => Value::from(value),
        SqliteValue::Blob(value) => Value::from(bytes_to_hex(&value)),
    }
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn initialize_database(app: &AppHandle) -> Result<(), String> {
    migrate_legacy_storage(app)?;
    let connection = open_connection(app)?;

    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .map_err(|error| error.to_string())?;

    for (version, name, sql) in MIGRATIONS {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
                [version],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;

        if exists == 0 {
            connection
                .execute_batch(sql)
                .map_err(|error| format!("Migration {version} impossible: {error}"))?;
            connection
                .execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                    (version, name),
                )
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn db_initialize(app: AppHandle) -> Result<(), String> {
    initialize_database(&app)
}

#[tauri::command]
pub fn db_execute(
    app: AppHandle,
    sql: String,
    params: Vec<DbParam>,
) -> Result<DbExecuteResult, String> {
    let connection = open_connection(&app)?;
    let values: Vec<SqliteValue> = params.into_iter().map(db_param_to_sqlite_value).collect();
    let rows_affected = connection
        .execute(&sql, params_from_iter(values.iter()))
        .map_err(|error| error.to_string())?;

    Ok(DbExecuteResult { rows_affected })
}

#[tauri::command]
pub fn db_transaction(
    app: AppHandle,
    statements: Vec<DbStatement>,
) -> Result<Vec<DbExecuteResult>, String> {
    let mut connection = open_connection(&app)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let mut results = Vec::with_capacity(statements.len());

    for statement in statements {
        let values: Vec<SqliteValue> = statement
            .params
            .into_iter()
            .map(db_param_to_sqlite_value)
            .collect();
        let rows_affected = transaction
            .execute(&statement.sql, params_from_iter(values.iter()))
            .map_err(|error| error.to_string())?;

        results.push(DbExecuteResult { rows_affected });
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(results)
}

#[tauri::command]
pub fn db_query(
    app: AppHandle,
    sql: String,
    params: Vec<DbParam>,
) -> Result<Vec<Map<String, Value>>, String> {
    let connection = open_connection(&app)?;
    let values: Vec<SqliteValue> = params.into_iter().map(db_param_to_sqlite_value).collect();
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let column_names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    let mut rows = statement
        .query(params_from_iter(values.iter()))
        .map_err(|error| error.to_string())?;
    let mut result = Vec::new();

    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let mut item = Map::new();

        for (index, column_name) in column_names.iter().enumerate() {
            let value = row
                .get::<usize, SqliteValue>(index)
                .map_err(|error| error.to_string())?;
            item.insert(column_name.clone(), sqlite_value_to_json(value));
        }

        result.push(item);
    }

    Ok(result)
}

#[tauri::command]
pub fn db_list_backups(app: AppHandle) -> Result<Vec<DatabaseBackup>, String> {
    let directory = backups_directory(&app)?;
    let mut backups = Vec::new();

    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("sqlite") {
            continue;
        }
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        backups.push(DatabaseBackup {
            absolute_path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            size_bytes: metadata.len(),
        });
    }

    backups.sort_by(|left, right| right.file_name.cmp(&left.file_name));
    Ok(backups)
}

#[tauri::command]
pub fn db_backup(app: AppHandle, file_name: String) -> Result<DatabaseBackup, String> {
    let source = database_path(&app)?;
    if !source.is_file() {
        return Err("La base locale n'existe pas encore.".to_string());
    }
    let target = backup_path(&app, &file_name)?;
    fs::copy(&source, &target).map_err(|error| error.to_string())?;
    let size_bytes = fs::metadata(&target).map_err(|error| error.to_string())?.len();
    Ok(DatabaseBackup {
        absolute_path: target.to_string_lossy().to_string(),
        file_name,
        size_bytes,
    })
}

#[tauri::command]
pub fn db_restore(app: AppHandle, file_name: String) -> Result<(), String> {
    let source = backup_path(&app, &file_name)?;
    if !source.is_file() {
        return Err("Sauvegarde introuvable.".to_string());
    }
    let target = database_path(&app)?;
    let temporary = target.with_extension("sqlite.restore.tmp");
    fs::copy(&source, &temporary).map_err(|error| error.to_string())?;
    fs::copy(&temporary, &target).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(temporary);
    initialize_database(&app)
}
