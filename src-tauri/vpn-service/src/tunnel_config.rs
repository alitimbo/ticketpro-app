use crate::identity::IdentityStore;
use crate::models::{TunnelConfig, TUNNEL_NAME};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const CONFIG_FILE_NAME: &str = "TicketProTunnel.conf.dpapi";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelConfigSelfTest {
    pub success: bool,
    pub encrypted_only: bool,
    pub detail_code: Option<&'static str>,
}

pub fn run_self_test() -> TunnelConfigSelfTest {
    let directory = std::env::temp_dir().join(format!("ticketpro-vpn-config-{}", Uuid::new_v4()));
    let result = (|| {
        fs::create_dir_all(&directory).map_err(|_| "TUNNEL_CONFIG_TEST_DIRECTORY_FAILED")?;
        let store = IdentityStore::new(directory.clone());
        store.ensure()?;
        let config = TunnelConfig {
            config_version: 1,
            address: "10.250.10.21/32".to_string(),
            gateway_public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".to_string(),
            endpoint_host: "vpn.ticketpro-ne.com".to_string(),
            endpoint_port: 51820,
            allowed_ips: vec!["10.250.0.0/16".to_string()],
            persistent_keepalive: 25,
        };
        let encrypted_path = persist(&store, &directory, &config)?;
        let encrypted = fs::read(&encrypted_path).map_err(|_| "TUNNEL_CONFIG_READ_FAILED")?;
        let plaintext = crate::dpapi::unprotect_with_description(&encrypted, TUNNEL_NAME)?;
        if !plaintext.starts_with(b"[Interface]")
            || !plaintext.windows(12).any(|window| window == b"PrivateKey =")
        {
            return Err("TUNNEL_CONFIG_CONTENT_INVALID");
        }
        if fs::read_dir(&directory)
            .map_err(|_| "TUNNEL_CONFIG_READ_FAILED")?
            .filter_map(Result::ok)
            .any(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("conf"))
        {
            return Err("TUNNEL_CONFIG_PLAINTEXT_FOUND");
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&directory);
    match result {
        Ok(()) => TunnelConfigSelfTest {
            success: true,
            encrypted_only: true,
            detail_code: None,
        },
        Err(code) => TunnelConfigSelfTest {
            success: false,
            encrypted_only: false,
            detail_code: Some(code),
        },
    }
}

pub fn path(directory: &Path) -> PathBuf {
    directory.join(CONFIG_FILE_NAME)
}

pub fn persist(
    store: &IdentityStore,
    directory: &Path,
    config: &TunnelConfig,
) -> Result<PathBuf, &'static str> {
    store.ensure()?;
    let plaintext = store.render_tunnel_config(config)?;
    let encrypted = crate::dpapi::protect_with_description(&plaintext, TUNNEL_NAME)?;
    let destination = path(directory);
    let temporary = directory.join(format!(".{CONFIG_FILE_NAME}.{}.tmp", Uuid::new_v4()));
    write_new(&temporary, &encrypted)?;
    crate::storage_security::protect_path(&temporary)?;
    if let Err(code) = replace_atomic(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(code);
    }
    crate::storage_security::protect_path(&destination)?;
    Ok(destination)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "TUNNEL_CONFIG_WRITE_FAILED")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "TUNNEL_CONFIG_WRITE_FAILED")
}

#[cfg(windows)]
fn replace_atomic(source: &Path, destination: &Path) -> Result<(), &'static str> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err("TUNNEL_CONFIG_REPLACE_FAILED")
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_atomic(_source: &Path, _destination: &Path) -> Result<(), &'static str> {
    Err("WINDOWS_REQUIRED")
}

#[cfg(test)]
mod tests {
    use super::{path, CONFIG_FILE_NAME};

    #[test]
    fn config_is_always_an_encrypted_wireguard_file() {
        let directory = std::path::Path::new(r"C:\ProgramData\TicketPro\vpn");
        let config = path(directory);
        assert_eq!(config.file_name().and_then(|name| name.to_str()), Some(CONFIG_FILE_NAME));
        assert!(config.to_string_lossy().ends_with(".conf.dpapi"));
    }
}
