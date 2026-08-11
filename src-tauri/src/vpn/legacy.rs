use super::models::{VpnProviderKind, VpnProviderStatus, VpnRuntimeState};
use super::provider::DesktopVpnProvider;

pub struct LegacyVpnProvider;

impl DesktopVpnProvider for LegacyVpnProvider {
    fn status(&self) -> VpnProviderStatus {
        let available = crate::wireguard::wireguard_available();
        VpnProviderStatus {
            provider: VpnProviderKind::Legacy,
            state: if available {
                VpnRuntimeState::Disconnected
            } else {
                VpnRuntimeState::Unavailable
            },
            service_name: "WireGuardTunnel$tp-*",
            service_version: None,
            detail_code: (!available).then(|| "LEGACY_WIREGUARD_NOT_INSTALLED".to_string()),
            last_handshake_unix_seconds: None,
            rx_bytes: 0,
            tx_bytes: 0,
        }
    }
}
