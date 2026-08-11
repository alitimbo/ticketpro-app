use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceManagementResult {
    pub success: bool,
    pub service_name: &'static str,
    pub state: &'static str,
    pub detail_code: Option<&'static str>,
}

impl ServiceManagementResult {
    fn success(state: &'static str) -> Self {
        Self {
            success: true,
            service_name: crate::models::SERVICE_NAME,
            state,
            detail_code: None,
        }
    }

    fn failure(state: &'static str, detail_code: &'static str) -> Self {
        Self {
            success: false,
            service_name: crate::models::SERVICE_NAME,
            state,
            detail_code: Some(detail_code),
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::ServiceManagementResult;
    use std::ffi::OsString;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    };
    use std::thread;
    use std::time::Duration;
    use windows_service::service::{
        ServiceAccess, ServiceControl, ServiceControlAccept, ServiceDependency,
        ServiceErrorControl, ServiceExitCode, ServiceInfo, ServiceSidType, ServiceStartType,
        ServiceState, ServiceStatus, ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    use windows_service::{define_windows_service, service_dispatcher};

    const SERVICE_NAME: &str = crate::models::SERVICE_NAME;
    const SERVICE_DISPLAY_NAME: &str = "TicketPro VPN Service";
    const SERVICE_DESCRIPTION: &str =
        "Gere la connexion securisee privee de TicketPro sans exposer les cles au frontend.";

    define_windows_service!(ffi_service_main, service_main);

    pub fn install() -> ServiceManagementResult {
        match install_inner() {
            Ok(state) => ServiceManagementResult::success(state),
            Err(code) => ServiceManagementResult::failure("INSTALL_FAILED", code),
        }
    }

    fn install_inner() -> Result<&'static str, &'static str> {
        let manager = ServiceManager::local_computer(
            None::<&str>,
            ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
        )
        .map_err(|_| "SERVICE_MANAGER_ACCESS_DENIED")?;

        if let Ok(service) = manager.open_service(
            SERVICE_NAME,
            ServiceAccess::QUERY_CONFIG | ServiceAccess::QUERY_STATUS | ServiceAccess::START,
        ) {
            let sid = service
                .get_config_service_sid_info()
                .map_err(|_| "SERVICE_SID_QUERY_FAILED")?;
            if sid != ServiceSidType::Unrestricted {
                return Err("SERVICE_SID_INVALID");
            }
            let status = service
                .query_status()
                .map_err(|_| "SERVICE_STATUS_QUERY_FAILED")?;
            if status.current_state == ServiceState::Stopped {
                service
                    .start::<&str>(&[])
                    .map_err(|_| "SERVICE_START_FAILED")?;
            }
            return Ok("ALREADY_INSTALLED");
        }

        let executable = std::env::current_exe().map_err(|_| "EXECUTABLE_PATH_UNAVAILABLE")?;
        if !executable.is_absolute() || !executable.is_file() {
            return Err("EXECUTABLE_PATH_INVALID");
        }
        let info = ServiceInfo {
            name: OsString::from(SERVICE_NAME),
            display_name: OsString::from(SERVICE_DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: executable,
            launch_arguments: vec![OsString::from("--service")],
            dependencies: vec![
                ServiceDependency::Service(OsString::from("Nsi")),
                ServiceDependency::Service(OsString::from("TcpIp")),
            ],
            account_name: None,
            account_password: None,
        };
        let service = manager
            .create_service(
                &info,
                ServiceAccess::CHANGE_CONFIG
                    | ServiceAccess::QUERY_CONFIG
                    | ServiceAccess::QUERY_STATUS
                    | ServiceAccess::START,
            )
            .map_err(|_| "SERVICE_CREATE_FAILED")?;
        service
            .set_description(SERVICE_DESCRIPTION)
            .map_err(|_| "SERVICE_DESCRIPTION_FAILED")?;
        service
            .set_config_service_sid_info(ServiceSidType::Unrestricted)
            .map_err(|_| "SERVICE_SID_CONFIGURATION_FAILED")?;
        service
            .start::<&str>(&[])
            .map_err(|_| "SERVICE_START_FAILED")?;
        Ok("INSTALLED")
    }

    pub fn uninstall() -> ServiceManagementResult {
        match uninstall_inner() {
            Ok(state) => ServiceManagementResult::success(state),
            Err(code) => ServiceManagementResult::failure("UNINSTALL_FAILED", code),
        }
    }

    fn uninstall_inner() -> Result<&'static str, &'static str> {
        crate::tunnel_service_manager::uninstall()?;
        let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
            .map_err(|_| "SERVICE_MANAGER_ACCESS_DENIED")?;
        let service = match manager.open_service(
            SERVICE_NAME,
            ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE,
        ) {
            Ok(service) => service,
            Err(_) => return Ok("NOT_INSTALLED"),
        };
        let status = service
            .query_status()
            .map_err(|_| "SERVICE_STATUS_QUERY_FAILED")?;
        if status.current_state != ServiceState::Stopped {
            service.stop().map_err(|_| "SERVICE_STOP_FAILED")?;
        }
        service.delete().map_err(|_| "SERVICE_DELETE_FAILED")?;
        Ok("REMOVAL_SCHEDULED")
    }

    pub fn query_status() -> ServiceManagementResult {
        let manager =
            match ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) {
                Ok(manager) => manager,
                Err(_) => {
                    return ServiceManagementResult::failure(
                        "UNKNOWN",
                        "SERVICE_MANAGER_UNAVAILABLE",
                    )
                }
            };
        let service = match manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS) {
            Ok(service) => service,
            Err(_) => return ServiceManagementResult::success("NOT_INSTALLED"),
        };
        match service.query_status() {
            Ok(status) => ServiceManagementResult::success(state_name(status.current_state)),
            Err(_) => ServiceManagementResult::failure("UNKNOWN", "SERVICE_STATUS_QUERY_FAILED"),
        }
    }

    fn state_name(state: ServiceState) -> &'static str {
        match state {
            ServiceState::Stopped => "STOPPED",
            ServiceState::StartPending => "START_PENDING",
            ServiceState::StopPending => "STOP_PENDING",
            ServiceState::Running => "RUNNING",
            ServiceState::ContinuePending => "CONTINUE_PENDING",
            ServiceState::PausePending => "PAUSE_PENDING",
            ServiceState::Paused => "PAUSED",
        }
    }

    pub fn run_dispatcher() -> Result<(), &'static str> {
        service_dispatcher::start(SERVICE_NAME, ffi_service_main)
            .map_err(|_| "SERVICE_DISPATCHER_FAILED")
    }

    fn service_main(_arguments: Vec<OsString>) {
        let _ = run_service();
    }

    fn run_service() -> windows_service::Result<()> {
        // Construct the privileged domain service before reporting RUNNING. This
        // validates the protected ProgramData storage while the process is
        // executing as LocalSystem. Identity creation itself remains lazy and
        // only happens after an explicit ENSURE_IDENTITY IPC request.
        let vpn_service = crate::service::VpnService::native()
            .map_err(|code| windows_service::Error::Winapi(std::io::Error::other(code)))?;

        let (shutdown_tx, shutdown_rx) = mpsc::channel();
        let shutdown = Arc::new(AtomicBool::new(false));
        let ipc_shutdown = Arc::clone(&shutdown);
        let ipc_thread = thread::Builder::new()
            .name("ticketpro-vpn-ipc".to_string())
            .spawn(move || crate::ipc::run_server(vpn_service, ipc_shutdown))
            .map_err(windows_service::Error::Winapi)?;
        let control_shutdown = Arc::clone(&shutdown);
        let event_handler = move |event| match event {
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            ServiceControl::Stop | ServiceControl::Shutdown => {
                control_shutdown.store(true, Ordering::Release);
                crate::ipc::wake_server();
                let _ = shutdown_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            _ => ServiceControlHandlerResult::NotImplemented,
        };
        let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;
        status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })?;

        let _ = shutdown_rx.recv();
        shutdown.store(true, Ordering::Release);
        crate::ipc::wake_server();
        let _ = ipc_thread.join();

        status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })?;
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::ServiceManagementResult;

    fn unsupported() -> ServiceManagementResult {
        ServiceManagementResult::failure("UNAVAILABLE", "WINDOWS_REQUIRED")
    }

    pub fn install() -> ServiceManagementResult {
        unsupported()
    }
    pub fn uninstall() -> ServiceManagementResult {
        unsupported()
    }
    pub fn query_status() -> ServiceManagementResult {
        unsupported()
    }
    pub fn run_dispatcher() -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }
}

pub use platform::{install, query_status, run_dispatcher, uninstall};

#[cfg(test)]
mod tests {
    use super::ServiceManagementResult;

    #[test]
    fn management_result_never_contains_raw_windows_errors() {
        let result = ServiceManagementResult::failure("UNKNOWN", "SERVICE_STATUS_QUERY_FAILED");
        let json = serde_json::to_string(&result).expect("serialize service result");
        assert!(!json.contains("Access is denied"));
        assert!(json.contains("SERVICE_STATUS_QUERY_FAILED"));
    }
}
