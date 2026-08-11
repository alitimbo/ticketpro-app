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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledWireGuardTunnel {
    pub active: bool,
    pub assigned_address: Option<String>,
    pub public_key: Option<String>,
    pub tunnel_name: String,
}

#[tauri::command]
pub fn wireguard_available() -> bool {
    wireguard_executable().is_some()
}

#[tauri::command]
pub fn wireguard_list_ticketpro_tunnels() -> Result<Vec<InstalledWireGuardTunnel>, String> {
    list_ticketpro_tunnels()
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

    // L'installation d'un service de tunnel WireGuard nécessite des droits
    // administrateur même lorsque TicketPro est installé pour l'utilisateur courant.
    // Une élévation UAC explicite évite l'échec silencieux observé depuis l'interface.
    if tunnel_service_exists(&input.tunnel_name) {
        run_wireguard_elevated(
            &executable,
            ["/uninstalltunnelservice", input.tunnel_name.as_str()],
        )?;
    }
    run_wireguard_elevated(
        &executable,
        [
            "/installtunnelservice",
            config_path.to_string_lossy().as_ref(),
        ],
    )?;
    if !tunnel_service_exists(&input.tunnel_name) {
        return Err(
            "WireGuard a terminé sans installer le service du tunnel. Vérifiez l'autorisation administrateur."
                .to_string(),
        );
    }

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
    if tunnel_service_exists(&tunnel_name) {
        run_wireguard_elevated(
            &executable,
            ["/uninstalltunnelservice", tunnel_name.as_str()],
        )?;
    }

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
    const RESERVED_NAMES: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let reserved_stem = name.split('.').next().unwrap_or_default();
    if name.is_empty()
        || name.len() > 32
        || name.starts_with('.')
        || name.ends_with('.')
        || RESERVED_NAMES
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(reserved_stem))
        || !name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '=' | '+' | '.' | '-')
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

#[cfg(windows)]
fn wireguard_tool_executable() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(r"C:\Program Files\WireGuard\wg.exe"),
        PathBuf::from(r"C:\Program Files (x86)\WireGuard\wg.exe"),
    ];
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .or_else(|| {
            let output = Command::new("where").arg("wg.exe").output().ok()?;
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
fn run_wireguard_elevated<const N: usize>(
    executable: &Path,
    args: [&str; N],
) -> Result<(), String> {
    let executable = powershell_quote(&executable.to_string_lossy());
    let argument_list = args
        .iter()
        .map(|argument| format!("'{}'", powershell_quote(argument)))
        .collect::<Vec<_>>()
        .join(", ");
    let script = format!(
        "$process = Start-Process -FilePath '{}' -ArgumentList @({}) -Verb RunAs -Wait -PassThru; if ($process.ExitCode -ne 0) {{ Write-Error ('WireGuard a retourné le code ' + $process.ExitCode); exit $process.ExitCode }}",
        executable, argument_list
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
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "L'élévation administrateur WireGuard a été refusée ou le service de tunnel n'a pas pu démarrer.".to_string()
        } else {
            format!("WireGuard n'a pas pu gérer le service de tunnel : {stderr}")
        })
    }
}

#[cfg(not(windows))]
fn run_wireguard_elevated<const N: usize>(
    executable: &Path,
    args: [&str; N],
) -> Result<(), String> {
    run_wireguard(executable, args)
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

fn tunnel_service_name(tunnel_name: &str) -> String {
    format!("WireGuardTunnel${tunnel_name}")
}

#[cfg(windows)]
fn tunnel_service_exists(tunnel_name: &str) -> bool {
    Command::new("sc.exe")
        .args(["query", tunnel_service_name(tunnel_name).as_str()])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn tunnel_service_exists(_tunnel_name: &str) -> bool {
    false
}

#[cfg(windows)]
fn list_ticketpro_tunnels() -> Result<Vec<InstalledWireGuardTunnel>, String> {
    let script = "Get-Service -Name 'WireGuardTunnel$tp-*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name.Substring(16) + '|' + $_.Status }";
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Impossible d'inventorier les tunnels WireGuard TicketPro : {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let wireguard_tool = wireguard_tool_executable();
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.trim().splitn(2, '|');
            let tunnel_name = fields.next()?;
            let status = fields.next()?;
            if validate_tunnel_name(tunnel_name).is_err() || !tunnel_name.starts_with("tp-") {
                return None;
            }
            let assigned_address = tunnel_ipv4_address(tunnel_name);
            let public_key = wireguard_tool.as_ref().and_then(|tool| {
                let result = Command::new(tool)
                    .args(["show", tunnel_name, "public-key"])
                    .output()
                    .ok()?;
                if !result.status.success() {
                    return None;
                }
                let key = String::from_utf8_lossy(&result.stdout).trim().to_string();
                (!key.is_empty()).then_some(key)
            });
            Some(InstalledWireGuardTunnel {
                active: status.eq_ignore_ascii_case("Running"),
                assigned_address,
                public_key,
                tunnel_name: tunnel_name.to_string(),
            })
        })
        .collect())
}

#[cfg(windows)]
fn tunnel_ipv4_address(tunnel_name: &str) -> Option<String> {
    let output = Command::new("netsh.exe")
        .args([
            "interface",
            "ipv4",
            "show",
            "addresses",
            &format!("name={tunnel_name}"),
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .map(|token| {
            token.trim_matches(|character: char| !character.is_ascii_digit() && character != '.')
        })
        .find(|candidate| is_ipv4_address(candidate))
        .map(ToOwned::to_owned)
}

fn is_ipv4_address(value: &str) -> bool {
    let octets = value
        .split('.')
        .map(str::parse::<u8>)
        .collect::<Result<Vec<_>, _>>();
    matches!(octets, Ok(parts) if parts.len() == 4)
}

#[cfg(not(windows))]
fn list_ticketpro_tunnels() -> Result<Vec<InstalledWireGuardTunnel>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::{tunnel_service_name, validate_tunnel_name};

    #[test]
    fn accepts_wireguard_windows_compatible_tunnel_names() {
        assert!(validate_tunnel_name("tp-1234567890_abc=def+ghi.jkl").is_ok());
        assert!(validate_tunnel_name("a").is_ok());
    }

    #[test]
    fn rejects_names_wireguard_windows_will_reject() {
        assert!(validate_tunnel_name("ticketpro-vpn-peer-12345678-1234-1234-1234").is_err());
        assert!(validate_tunnel_name("CON").is_err());
        assert!(validate_tunnel_name(".hidden").is_err());
        assert!(validate_tunnel_name("invalid name").is_err());
    }

    #[test]
    fn builds_the_wireguard_windows_service_name() {
        assert_eq!(tunnel_service_name("tp-demo"), "WireGuardTunnel$tp-demo");
    }
}
