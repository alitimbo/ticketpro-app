mod embedded;
mod ipc_client;
mod legacy;
mod models;
mod provider;

use models::{VpnProviderStatus, VpnPublicIdentity, VpnTunnelConfig};

#[tauri::command]
pub fn vpn_provider_status() -> VpnProviderStatus {
    provider::selected_provider().status()
}

#[tauri::command]
pub fn vpn_ensure_identity() -> Result<VpnPublicIdentity, String> {
    if !provider::embedded_provider_selected() {
        return Err("EMBEDDED_VPN_NOT_SELECTED".to_string());
    }
    embedded::ensure_identity().map_err(str::to_string)
}

#[tauri::command]
pub fn vpn_apply_config(config: VpnTunnelConfig) -> Result<(), String> {
    require_embedded()?;
    embedded::apply_config(config).map_err(str::to_string)
}

#[tauri::command]
pub fn vpn_connect() -> Result<(), String> {
    require_embedded()?;
    embedded::start().map_err(str::to_string)
}

#[tauri::command]
pub fn vpn_disconnect() -> Result<(), String> {
    require_embedded()?;
    embedded::stop().map_err(str::to_string)
}

#[tauri::command]
pub fn vpn_repair() -> Result<(), String> {
    require_embedded()?;
    embedded::repair().map_err(str::to_string)
}

#[tauri::command]
pub fn vpn_prepare_identity_rotation() -> Result<VpnPublicIdentity, String> {
    require_embedded()?;
    embedded::prepare_identity_rotation().map_err(str::to_string)
}

#[tauri::command]
pub fn vpn_commit_identity_rotation() -> Result<(), String> {
    require_embedded()?;
    embedded::commit_identity_rotation().map_err(str::to_string)
}

#[tauri::command]
pub fn vpn_abort_identity_rotation() -> Result<(), String> {
    require_embedded()?;
    embedded::abort_identity_rotation().map_err(str::to_string)
}

fn require_embedded() -> Result<(), String> {
    if provider::embedded_provider_selected() {
        Ok(())
    } else {
        Err("EMBEDDED_VPN_NOT_SELECTED".to_string())
    }
}
