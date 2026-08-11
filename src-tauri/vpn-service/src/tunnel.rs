use crate::models::{TunnelConfig, TunnelStatus};
use std::path::PathBuf;

pub trait TunnelService: Send + Sync {
    fn status(&self) -> TunnelStatus;
    fn apply_config(&self, config: &TunnelConfig) -> Result<(), &'static str>;
    fn start(&self) -> Result<(), &'static str>;
    fn stop(&self) -> Result<(), &'static str>;
    fn repair(&self) -> Result<(), &'static str>;
}

pub struct PocTunnelService;

impl TunnelService for PocTunnelService {
    fn status(&self) -> TunnelStatus {
        TunnelStatus {
            state: crate::models::TunnelState::Unavailable,
            service_name: crate::models::SERVICE_NAME,
            tunnel_name: crate::models::TUNNEL_NAME,
            service_version: env!("CARGO_PKG_VERSION"),
            detail_code: Some("WIREGUARD_EMBEDDABLE_NOT_LINKED"),
            last_handshake_unix_seconds: None,
            rx_bytes: 0,
            tx_bytes: 0,
        }
    }

    fn apply_config(&self, config: &TunnelConfig) -> Result<(), &'static str> {
        config.validate()?;
        Err("WIREGUARD_EMBEDDABLE_NOT_LINKED")
    }

    fn start(&self) -> Result<(), &'static str> {
        Err("WIREGUARD_EMBEDDABLE_NOT_LINKED")
    }

    fn stop(&self) -> Result<(), &'static str> {
        Ok(())
    }

    fn repair(&self) -> Result<(), &'static str> {
        Err("WIREGUARD_EMBEDDABLE_NOT_LINKED")
    }
}

pub struct NativeTunnelService {
    identity: crate::identity::IdentityStore,
    data_directory: PathBuf,
}

impl NativeTunnelService {
    pub fn new(identity: crate::identity::IdentityStore, data_directory: PathBuf) -> Self {
        Self {
            identity,
            data_directory,
        }
    }
}

impl TunnelService for NativeTunnelService {
    fn status(&self) -> TunnelStatus {
        let (state, detail_code, telemetry) = native_status();
        TunnelStatus {
            state,
            service_name: crate::models::SERVICE_NAME,
            tunnel_name: crate::models::TUNNEL_NAME,
            service_version: env!("CARGO_PKG_VERSION"),
            detail_code,
            last_handshake_unix_seconds: telemetry
                .as_ref()
                .and_then(|value| value.last_handshake_unix_seconds),
            rx_bytes: telemetry.as_ref().map_or(0, |value| value.rx_bytes),
            tx_bytes: telemetry.as_ref().map_or(0, |value| value.tx_bytes),
        }
    }

    fn apply_config(&self, config: &TunnelConfig) -> Result<(), &'static str> {
        config.validate()?;
        crate::tunnel_service_manager::stop()?;
        let config_path =
            crate::tunnel_config::persist(&self.identity, &self.data_directory, config)?;
        crate::tunnel_service_manager::ensure_installed(&config_path)?;
        crate::tunnel_service_manager::start()
    }

    fn start(&self) -> Result<(), &'static str> {
        crate::tunnel_service_manager::start()
    }

    fn stop(&self) -> Result<(), &'static str> {
        crate::tunnel_service_manager::stop()
    }

    fn repair(&self) -> Result<(), &'static str> {
        let config_path = crate::tunnel_config::path(&self.data_directory);
        if !config_path.is_file() {
            return Err("TUNNEL_CONFIG_MISSING");
        }
        crate::tunnel_service_manager::stop()?;
        crate::tunnel_service_manager::ensure_installed(&config_path)?;
        crate::tunnel_service_manager::start()
    }
}

fn native_status() -> (
    crate::models::TunnelState,
    Option<&'static str>,
    Option<crate::wireguard_ffi::AdapterTelemetry>,
) {
    match crate::tunnel_service_manager::state() {
        Ok(crate::models::TunnelState::Connected) => match crate::wireguard_ffi::adapter_telemetry()
        {
            Ok(telemetry) if !telemetry.adapter_up => (
                crate::models::TunnelState::Connecting,
                Some("WIREGUARD_ADAPTER_DOWN"),
                Some(telemetry),
            ),
            Ok(telemetry) => {
                let Some(handshake) = telemetry.last_handshake_unix_seconds else {
                    return (
                        crate::models::TunnelState::Connecting,
                        Some("WIREGUARD_HANDSHAKE_PENDING"),
                        Some(telemetry),
                    );
                };
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |duration| duration.as_secs());
                if now.saturating_sub(handshake) <= 180 {
                    (crate::models::TunnelState::Connected, None, Some(telemetry))
                } else {
                    (
                        crate::models::TunnelState::Degraded,
                        Some("WIREGUARD_HANDSHAKE_STALE"),
                        Some(telemetry),
                    )
                }
            }
            Err("WIREGUARD_ADAPTER_NOT_FOUND") => (
                crate::models::TunnelState::Connecting,
                Some("WIREGUARD_ADAPTER_NOT_READY"),
                None,
            ),
            Err(code) => (crate::models::TunnelState::Error, Some(code), None),
        },
        Ok(state) => (state, None, None),
        Err(code) => (crate::models::TunnelState::Error, Some(code), None),
    }
}
