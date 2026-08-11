mod dpapi;
mod identity;
mod ipc;
mod models;
mod protocol;
mod service;
mod storage_security;
mod tunnel;
mod tunnel_config;
mod tunnel_service_manager;
mod windows_service_lifecycle;
mod wireguard_ffi;

use service::VpnService;

fn main() {
    let argument = std::env::args().nth(1);
    match argument.as_deref() {
        Some("--version") => println!("{}", env!("CARGO_PKG_VERSION")),
        Some("--self-test") => {
            let service = VpnService::poc();
            let response = service.handle(protocol::ServiceRequest::GetStatus);
            println!(
                "{}",
                serde_json::to_string(&response).expect("self-test response must serialize")
            );
        }
        Some("--component-self-test") => {
            let response = wireguard_ffi::run_component_self_test();
            println!(
                "{}",
                serde_json::to_string(&response).expect("component self-test must serialize")
            );
            if !response.success {
                std::process::exit(1);
            }
        }
        Some("--identity-self-test") => {
            let response = identity::run_identity_self_test();
            println!(
                "{}",
                serde_json::to_string(&response).expect("identity self-test must serialize")
            );
            if !response.success {
                std::process::exit(1);
            }
        }
        Some("--dpapi-self-test") => match dpapi::self_test() {
            Ok(()) => println!("{}", r#"{"success":true,"detailCode":null}"#),
            Err(code) => {
                println!("{{\"success\":false,\"detailCode\":\"{code}\"}}");
                std::process::exit(1);
            }
        },
        Some("--identity-crypto-self-test") => match identity::run_identity_crypto_self_test() {
            Ok(()) => println!("{}", r#"{"success":true,"detailCode":null}"#),
            Err(code) => {
                println!("{{\"success\":false,\"detailCode\":\"{code}\"}}");
                std::process::exit(1);
            }
        },
        Some("--ipc-self-test") => {
            let response = ipc::run_self_test();
            println!(
                "{}",
                serde_json::to_string(&response).expect("ipc self-test must serialize")
            );
            if !response.success {
                std::process::exit(1);
            }
        }
        Some("--tunnel-config-self-test") => {
            let response = tunnel_config::run_self_test();
            println!(
                "{}",
                serde_json::to_string(&response)
                    .expect("tunnel config self-test must serialize")
            );
            if !response.success {
                std::process::exit(1);
            }
        }
        Some("--install-service") => print_service_result(windows_service_lifecycle::install()),
        Some("--uninstall-service") => print_service_result(windows_service_lifecycle::uninstall()),
        Some("--service-status") => print_service_result(windows_service_lifecycle::query_status()),
        Some("--service") => {
            if windows_service_lifecycle::run_dispatcher().is_err() {
                std::process::exit(1);
            }
        }
        Some("--tunnel-service") => {
            let Some(config_path) = std::env::args().nth(2).map(std::path::PathBuf::from) else {
                std::process::exit(2);
            };
            if wireguard_ffi::run_tunnel_service(&config_path).is_err() {
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!(
                "TicketProVpnService: utilisez --service-status, --self-test, --component-self-test ou --identity-self-test."
            );
            std::process::exit(2);
        }
    }
}

fn print_service_result(result: windows_service_lifecycle::ServiceManagementResult) {
    println!(
        "{}",
        serde_json::to_string(&result).expect("service result must serialize")
    );
    if !result.success {
        std::process::exit(1);
    }
}
