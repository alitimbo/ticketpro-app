use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const FILES_DIRECTORY: &str = "files";
const MAX_FILE_SIZE: usize = 50 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ManagedFileResult {
    pub absolute_path: String,
    pub bytes_written: usize,
    pub relative_path: String,
}

#[derive(Debug, Serialize)]
pub struct ManagedFileMetadata {
    pub absolute_path: String,
    pub exists: bool,
    pub relative_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ExportedFileResult {
    pub absolute_path: String,
    pub file_name: String,
}

fn files_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let directory = data_dir.join(FILES_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

pub(crate) fn managed_file_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    managed_path(app, relative_path).map(|(path, _)| path)
}

fn managed_path(app: &AppHandle, relative_path: &str) -> Result<(PathBuf, String), String> {
    let path = Path::new(relative_path);

    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Chemin de fichier invalide.".to_string());
    }

    let normalized = path.to_string_lossy().replace('\\', "/");
    let prefix = format!("{FILES_DIRECTORY}/");

    if !normalized.starts_with(&prefix) || normalized.len() <= prefix.len() {
        return Err("Le fichier doit être stocké dans le dossier TicketPro.".to_string());
    }

    let file_name = Path::new(&normalized)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Nom de fichier invalide.".to_string())?;

    if file_name.is_empty() || file_name == "." {
        return Err("Nom de fichier invalide.".to_string());
    }

    let directory = files_directory(app)?;
    Ok((directory.join(file_name), normalized))
}

#[tauri::command]
pub fn file_write_bytes(
    app: AppHandle,
    relative_path: String,
    bytes: Vec<u8>,
) -> Result<ManagedFileResult, String> {
    if bytes.len() > MAX_FILE_SIZE {
        return Err("Le fichier dépasse la taille maximale autorisée.".to_string());
    }

    let (path, normalized) = managed_path(&app, &relative_path)?;
    fs::write(&path, &bytes).map_err(|error| error.to_string())?;

    Ok(ManagedFileResult {
        absolute_path: path.to_string_lossy().to_string(),
        bytes_written: bytes.len(),
        relative_path: normalized,
    })
}

#[tauri::command]
pub fn file_metadata(app: AppHandle, relative_path: String) -> Result<ManagedFileMetadata, String> {
    let (path, normalized) = managed_path(&app, &relative_path)?;
    let metadata = fs::metadata(&path).ok();

    Ok(ManagedFileMetadata {
        absolute_path: path.to_string_lossy().to_string(),
        exists: metadata.is_some(),
        relative_path: normalized,
        size_bytes: metadata.map(|value| value.len()).unwrap_or(0),
    })
}

#[tauri::command]
pub fn file_open(app: AppHandle, relative_path: String) -> Result<(), String> {
    let (path, _) = managed_path(&app, &relative_path)?;

    if !path.is_file() {
        return Err("Fichier introuvable.".to_string());
    }

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn file_reveal(app: AppHandle, relative_path: String) -> Result<(), String> {
    let (path, _) = managed_path(&app, &relative_path)?;

    if !path.exists() {
        return Err("Fichier introuvable.".to_string());
    }

    app.opener()
        .reveal_item_in_dir(path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn file_remove(app: AppHandle, relative_path: String) -> Result<(), String> {
    let (path, _) = managed_path(&app, &relative_path)?;

    if !path.exists() {
        return Ok(());
    }

    if !path.is_file() {
        return Err("Le chemin ne correspond pas à un fichier.".to_string());
    }

    fs::remove_file(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn file_export_to_downloads(
    app: AppHandle,
    relative_path: String,
) -> Result<ExportedFileResult, String> {
    let (source, _) = managed_path(&app, &relative_path)?;

    if !source.is_file() {
        return Err("Fichier introuvable.".to_string());
    }

    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    let export_directory = downloads.join("TicketPro");
    fs::create_dir_all(&export_directory).map_err(|error| error.to_string())?;
    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Nom de fichier invalide.".to_string())?;
    let destination = available_export_path(&export_directory, original_name);
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;

    Ok(ExportedFileResult {
        absolute_path: destination.to_string_lossy().to_string(),
        file_name: destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(original_name)
            .to_string(),
    })
}

fn available_export_path(directory: &Path, file_name: &str) -> PathBuf {
    let requested = directory.join(file_name);
    if !requested.exists() {
        return requested;
    }

    let file_path = Path::new(file_name);
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("ticketpro");
    let extension = file_path.extension().and_then(|value| value.to_str());

    for index in 1..10_000 {
        let candidate_name = match extension {
            Some(value) => format!("{stem}-{index}.{value}"),
            None => format!("{stem}-{index}"),
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!("{stem}-{}", std::process::id()))
}
