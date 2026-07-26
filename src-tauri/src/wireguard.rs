use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const WIREGUARD_DIRECTORY: &str = "wireguard";
const WIREGUARD_INSTALLER_URL: &str =
    "https://download.wireguard.com/windows-client/wireguard-installer.exe";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireGuardTunnelInput {
    pub config: String,
    pub tunnel_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireGuardTunnelStatus {
    pub active: bool,
    pub config_path: String,
    pub tunnel_name: String,
}

#[tauri::command]
pub fn wireguard_available() -> bool {
    wireguard_executable().is_some()
}

#[tauri::command]
pub fn wireguard_install(app: AppHandle) -> Result<(), String> {
    if wireguard_available() {
        return Ok(());
    }

    let directory = wireguard_directory(&app)?;
    let installer_path = directory.join("wireguard-installer.exe");
    download_installer(&installer_path)?;
    verify_installer_signature(&installer_path)?;
    install_elevated(&installer_path)?;
    let _ = fs::remove_file(&installer_path);

    for _ in 0..60 {
        if wireguard_available() {
            return Ok(());
        }
        thread::sleep(Duration::from_secs(1));
    }

    Err("WireGuard n'est pas apparu après son installation.".to_string())
}

#[tauri::command]
pub fn wireguard_tunnel_up(
    app: AppHandle,
    input: WireGuardTunnelInput,
) -> Result<WireGuardTunnelStatus, String> {
    validate_tunnel_name(&input.tunnel_name)?;
    if input.config.trim().is_empty() {
        return Err("La configuration WireGuard est vide.".to_string());
    }

    let executable = wireguard_executable().ok_or_else(|| {
        "WireGuard Windows n'est pas installé. Installez le composant WireGuard pour activer le tunnel automatiquement.".to_string()
    })?;
    let directory = wireguard_directory(&app)?;
    let config_path = directory.join(format!("{}.conf", input.tunnel_name));
    fs::write(&config_path, input.config.as_bytes()).map_err(|error| error.to_string())?;

    let _ = run_wireguard(
        &executable,
        ["/uninstalltunnelservice", input.tunnel_name.as_str()],
    );
    run_wireguard(
        &executable,
        [
            "/installtunnelservice",
            config_path.to_string_lossy().as_ref(),
        ],
    )?;

    Ok(WireGuardTunnelStatus {
        active: true,
        config_path: config_path.to_string_lossy().to_string(),
        tunnel_name: input.tunnel_name,
    })
}

#[tauri::command]
pub fn wireguard_tunnel_down(app: AppHandle, tunnel_name: String) -> Result<(), String> {
    validate_tunnel_name(&tunnel_name)?;
    let executable = wireguard_executable()
        .ok_or_else(|| "WireGuard Windows n'est pas installé.".to_string())?;
    run_wireguard(
        &executable,
        ["/uninstalltunnelservice", tunnel_name.as_str()],
    )?;

    let config_path = wireguard_directory(&app)?.join(format!("{tunnel_name}.conf"));
    let _ = fs::remove_file(config_path);
    Ok(())
}

fn wireguard_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(WIREGUARD_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn validate_tunnel_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 48
        || !name.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Nom de tunnel WireGuard invalide.".to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn wireguard_executable() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(r"C:\Program Files\WireGuard\wireguard.exe"),
        PathBuf::from(r"C:\Program Files (x86)\WireGuard\wireguard.exe"),
    ];
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .or_else(|| {
            let output = Command::new("where").arg("wireguard.exe").output().ok()?;
            if !output.status.success() {
                return None;
            }
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()?
                .trim()
                .to_string();
            (!path.is_empty()).then(|| PathBuf::from(path))
        })
}

#[cfg(not(windows))]
fn wireguard_executable() -> Option<PathBuf> {
    None
}

fn run_wireguard<const N: usize>(executable: &Path, args: [&str; N]) -> Result<(), String> {
    let output = Command::new(executable)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if message.is_empty() {
        "WireGuard n'a pas pu démarrer le tunnel.".to_string()
    } else {
        format!("WireGuard n'a pas pu démarrer le tunnel : {message}")
    })
}

#[cfg(windows)]
fn download_installer(path: &Path) -> Result<(), String> {
    let path = powershell_quote(&path.to_string_lossy());
    let script = format!(
        "Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'",
        powershell_quote(WIREGUARD_INSTALLER_URL),
        path
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Téléchargement de WireGuard impossible : {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(not(windows))]
fn download_installer(_path: &Path) -> Result<(), String> {
    Err(
        "L'installation automatique de WireGuard est disponible uniquement sur Windows."
            .to_string(),
    )
}

#[cfg(windows)]
fn install_elevated(path: &Path) -> Result<(), String> {
    let script = format!(
        "$process = Start-Process -FilePath '{}' -Verb RunAs -Wait -PassThru; if ($process.ExitCode -ne 0) {{ exit $process.ExitCode }}",
        powershell_quote(&path.to_string_lossy())
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("L'installation WireGuard a été refusée ou a échoué.".to_string())
    }
}

#[cfg(windows)]
fn verify_installer_signature(path: &Path) -> Result<(), String> {
    let script = format!(
        "$signature = Get-AuthenticodeSignature -FilePath '{}'; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'WireGuard') {{ exit 1 }}",
        powershell_quote(&path.to_string_lossy())
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(
            "La signature numérique de l'installateur WireGuard est absente ou invalide."
                .to_string(),
        )
    }
}

#[cfg(not(windows))]
fn verify_installer_signature(_path: &Path) -> Result<(), String> {
    Err("La vérification de WireGuard est disponible uniquement sur Windows.".to_string())
}

#[cfg(not(windows))]
fn install_elevated(_path: &Path) -> Result<(), String> {
    Err(
        "L'installation automatique de WireGuard est disponible uniquement sur Windows."
            .to_string(),
    )
}

fn powershell_quote(value: &str) -> String {
    value.replace('\'', "''")
}
