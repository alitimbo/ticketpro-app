use crate::models::TunnelState;
use std::path::Path;

pub const TUNNEL_SERVICE_NAME: &str = "WireGuardTunnel$TicketProTunnel";

pub fn ensure_installed(config_path: &Path) -> Result<(), &'static str> {
    platform::ensure_installed(config_path)
}

pub fn start() -> Result<(), &'static str> {
    platform::start()
}

pub fn stop() -> Result<(), &'static str> {
    platform::stop()
}

pub fn state() -> Result<TunnelState, &'static str> {
    platform::state()
}

pub fn uninstall() -> Result<(), &'static str> {
    platform::uninstall()
}

#[cfg(windows)]
mod platform {
    use super::{Path, TunnelState, TUNNEL_SERVICE_NAME};
    use std::ffi::OsString;
    use std::time::{Duration, Instant};
    use windows_service::service::{
        ServiceAccess, ServiceDependency, ServiceErrorControl, ServiceInfo, ServiceSidType,
        ServiceStartType, ServiceState, ServiceType,
    };
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    const DISPLAY_NAME: &str = "TicketPro Secure Tunnel";
    const DESCRIPTION: &str =
        "Tunnel WireGuard prive gere automatiquement par TicketProVpnService.";

    pub fn ensure_installed(config_path: &Path) -> Result<(), &'static str> {
        if !config_path.is_absolute()
            || config_path.file_name().and_then(|name| name.to_str())
                != Some("TicketProTunnel.conf.dpapi")
        {
            return Err("TUNNEL_CONFIG_PATH_INVALID");
        }
        let manager = manager(ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE)?;
        let info = service_info(config_path)?;
        let service = match manager.open_service(
            TUNNEL_SERVICE_NAME,
            ServiceAccess::CHANGE_CONFIG
                | ServiceAccess::QUERY_CONFIG
                | ServiceAccess::QUERY_STATUS
                | ServiceAccess::START
                | ServiceAccess::STOP,
        ) {
            Ok(service) => {
                service
                    .change_config(&info)
                    .map_err(|_| "TUNNEL_SERVICE_UPDATE_FAILED")?;
                service
            }
            Err(_) => manager
                .create_service(
                    &info,
                    ServiceAccess::CHANGE_CONFIG
                        | ServiceAccess::QUERY_CONFIG
                        | ServiceAccess::QUERY_STATUS
                        | ServiceAccess::START
                        | ServiceAccess::STOP,
                )
                .map_err(|_| "TUNNEL_SERVICE_CREATE_FAILED")?,
        };
        service
            .set_description(DESCRIPTION)
            .map_err(|_| "TUNNEL_SERVICE_DESCRIPTION_FAILED")?;
        service
            .set_config_service_sid_info(ServiceSidType::Unrestricted)
            .map_err(|_| "TUNNEL_SERVICE_SID_FAILED")?;
        let sid = service
            .get_config_service_sid_info()
            .map_err(|_| "TUNNEL_SERVICE_SID_QUERY_FAILED")?;
        if sid != ServiceSidType::Unrestricted {
            return Err("TUNNEL_SERVICE_SID_INVALID");
        }
        Ok(())
    }

    pub fn start() -> Result<(), &'static str> {
        let manager = manager(ServiceManagerAccess::CONNECT)?;
        let service = manager
            .open_service(
                TUNNEL_SERVICE_NAME,
                ServiceAccess::QUERY_STATUS | ServiceAccess::START,
            )
            .map_err(|_| "TUNNEL_SERVICE_NOT_INSTALLED")?;
        let status = service
            .query_status()
            .map_err(|_| "TUNNEL_SERVICE_STATUS_FAILED")?;
        match status.current_state {
            ServiceState::Running | ServiceState::StartPending => Ok(()),
            ServiceState::Stopped => service
                .start::<&str>(&[])
                .map_err(|_| "TUNNEL_SERVICE_START_FAILED"),
            _ => Err("TUNNEL_SERVICE_BUSY"),
        }
    }

    pub fn stop() -> Result<(), &'static str> {
        let manager = manager(ServiceManagerAccess::CONNECT)?;
        let service = match manager.open_service(
            TUNNEL_SERVICE_NAME,
            ServiceAccess::QUERY_STATUS | ServiceAccess::STOP,
        ) {
            Ok(service) => service,
            Err(_) => return Ok(()),
        };
        let status = service
            .query_status()
            .map_err(|_| "TUNNEL_SERVICE_STATUS_FAILED")?;
        if status.current_state == ServiceState::Stopped {
            return Ok(());
        }
        if status.current_state != ServiceState::StopPending {
            service.stop().map_err(|_| "TUNNEL_SERVICE_STOP_FAILED")?;
        }
        wait_for_stopped(&service)
    }

    pub fn state() -> Result<TunnelState, &'static str> {
        let manager = manager(ServiceManagerAccess::CONNECT)?;
        let service = match manager.open_service(TUNNEL_SERVICE_NAME, ServiceAccess::QUERY_STATUS) {
            Ok(service) => service,
            Err(_) => return Ok(TunnelState::Disconnected),
        };
        let status = service
            .query_status()
            .map_err(|_| "TUNNEL_SERVICE_STATUS_FAILED")?;
        Ok(match status.current_state {
            ServiceState::Running => TunnelState::Connected,
            ServiceState::StartPending | ServiceState::ContinuePending => TunnelState::Connecting,
            ServiceState::Stopped | ServiceState::StopPending | ServiceState::Paused => {
                TunnelState::Disconnected
            }
            ServiceState::PausePending => TunnelState::Degraded,
        })
    }

    pub fn uninstall() -> Result<(), &'static str> {
        stop()?;
        let manager = manager(ServiceManagerAccess::CONNECT)?;
        let service = match manager.open_service(TUNNEL_SERVICE_NAME, ServiceAccess::DELETE) {
            Ok(service) => service,
            Err(_) => return Ok(()),
        };
        service
            .delete()
            .map_err(|_| "TUNNEL_SERVICE_DELETE_FAILED")
    }

    fn service_info(config_path: &Path) -> Result<ServiceInfo, &'static str> {
        let executable = std::env::current_exe().map_err(|_| "EXECUTABLE_PATH_UNAVAILABLE")?;
        if !executable.is_absolute() || !executable.is_file() {
            return Err("EXECUTABLE_PATH_INVALID");
        }
        Ok(ServiceInfo {
            name: OsString::from(TUNNEL_SERVICE_NAME),
            display_name: OsString::from(DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: executable,
            launch_arguments: vec![
                OsString::from("--tunnel-service"),
                config_path.as_os_str().to_os_string(),
            ],
            dependencies: vec![
                ServiceDependency::Service(OsString::from("Nsi")),
                ServiceDependency::Service(OsString::from("TcpIp")),
            ],
            account_name: None,
            account_password: None,
        })
    }

    fn manager(access: ServiceManagerAccess) -> Result<ServiceManager, &'static str> {
        ServiceManager::local_computer(None::<&str>, access)
            .map_err(|_| "SERVICE_MANAGER_UNAVAILABLE")
    }

    fn wait_for_stopped(service: &windows_service::service::Service) -> Result<(), &'static str> {
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            let status = service
                .query_status()
                .map_err(|_| "TUNNEL_SERVICE_STATUS_FAILED")?;
            if status.current_state == ServiceState::Stopped {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("TUNNEL_SERVICE_STOP_TIMEOUT")
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{Path, TunnelState};

    pub fn ensure_installed(_config_path: &Path) -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }
    pub fn start() -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }
    pub fn stop() -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }
    pub fn state() -> Result<TunnelState, &'static str> {
        Err("WINDOWS_REQUIRED")
    }
    pub fn uninstall() -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }
}

#[cfg(test)]
mod tests {
    use super::TUNNEL_SERVICE_NAME;

    #[test]
    fn service_name_follows_the_official_wireguard_convention() {
        assert_eq!(TUNNEL_SERVICE_NAME, "WireGuardTunnel$TicketProTunnel");
    }
}
