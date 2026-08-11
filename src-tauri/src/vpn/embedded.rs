use super::models::{
    VpnProviderKind, VpnProviderStatus, VpnPublicIdentity, VpnRuntimeState, VpnTunnelConfig,
};
use super::provider::DesktopVpnProvider;
use serde_json::Value;

pub const TICKETPRO_VPN_SERVICE_NAME: &str = "TicketProVpnService";

pub struct EmbeddedVpnProvider;

impl DesktopVpnProvider for EmbeddedVpnProvider {
    fn status(&self) -> VpnProviderStatus {
        let response = match super::ipc_client::request("GET_STATUS") {
            Ok(response) => response,
            Err(code) => return unavailable(code),
        };
        let Some(payload) = response.get("payload") else {
            return unavailable("VPN_SERVICE_RESPONSE_INVALID");
        };
        if response.get("type").and_then(Value::as_str) != Some("STATUS") {
            return unavailable("VPN_SERVICE_RESPONSE_INVALID");
        }
        VpnProviderStatus {
            provider: VpnProviderKind::Embedded,
            state: map_state(payload.get("state").and_then(Value::as_str)),
            service_name: TICKETPRO_VPN_SERVICE_NAME,
            service_version: payload
                .get("serviceVersion")
                .and_then(Value::as_str)
                .map(str::to_string),
            detail_code: payload
                .get("detailCode")
                .and_then(Value::as_str)
                .map(str::to_string),
            last_handshake_unix_seconds: payload
                .get("lastHandshakeUnixSeconds")
                .and_then(Value::as_u64),
            rx_bytes: payload.get("rxBytes").and_then(Value::as_u64).unwrap_or(0),
            tx_bytes: payload.get("txBytes").and_then(Value::as_u64).unwrap_or(0),
        }
    }
}

pub fn ensure_identity() -> Result<VpnPublicIdentity, &'static str> {
    let response = super::ipc_client::request("ENSURE_IDENTITY")?;
    if response.get("type").and_then(Value::as_str) == Some("ERROR") {
        return Err("VPN_IDENTITY_UNAVAILABLE");
    }
    if response.get("type").and_then(Value::as_str) != Some("PUBLIC_IDENTITY") {
        return Err("VPN_SERVICE_RESPONSE_INVALID");
    }
    serde_json::from_value(
        response
            .get("payload")
            .cloned()
            .ok_or("VPN_SERVICE_RESPONSE_INVALID")?,
    )
    .map_err(|_| "VPN_PUBLIC_IDENTITY_INVALID")
}

pub fn apply_config(config: VpnTunnelConfig) -> Result<(), &'static str> {
    config.validate()?;
    let payload = serde_json::to_value(config).map_err(|_| "VPN_TUNNEL_CONFIG_INVALID")?;
    expect_accepted(super::ipc_client::request_with_payload(
        "APPLY_CONFIG",
        Some(payload),
    )?)
}

pub fn start() -> Result<(), &'static str> {
    expect_accepted(super::ipc_client::request("START")?)
}

pub fn stop() -> Result<(), &'static str> {
    expect_accepted(super::ipc_client::request("STOP")?)
}

pub fn repair() -> Result<(), &'static str> {
    expect_accepted(super::ipc_client::request("REPAIR")?)
}

pub fn prepare_identity_rotation() -> Result<VpnPublicIdentity, &'static str> {
    public_identity_response(super::ipc_client::request("PREPARE_IDENTITY_ROTATION")?)
}

pub fn commit_identity_rotation() -> Result<(), &'static str> {
    expect_accepted(super::ipc_client::request("COMMIT_IDENTITY_ROTATION")?)
}

pub fn abort_identity_rotation() -> Result<(), &'static str> {
    expect_accepted(super::ipc_client::request("ABORT_IDENTITY_ROTATION")?)
}

fn public_identity_response(response: Value) -> Result<VpnPublicIdentity, &'static str> {
    if response.get("type").and_then(Value::as_str) == Some("ERROR") {
        return Err("VPN_IDENTITY_UNAVAILABLE");
    }
    if response.get("type").and_then(Value::as_str) != Some("PUBLIC_IDENTITY") {
        return Err("VPN_SERVICE_RESPONSE_INVALID");
    }
    serde_json::from_value(
        response
            .get("payload")
            .cloned()
            .ok_or("VPN_SERVICE_RESPONSE_INVALID")?,
    )
    .map_err(|_| "VPN_PUBLIC_IDENTITY_INVALID")
}

fn expect_accepted(response: Value) -> Result<(), &'static str> {
    match response.get("type").and_then(Value::as_str) {
        Some("ACCEPTED") => Ok(()),
        Some("ERROR") => Err("VPN_SERVICE_OPERATION_FAILED"),
        _ => Err("VPN_SERVICE_RESPONSE_INVALID"),
    }
}

fn unavailable(code: &'static str) -> VpnProviderStatus {
    VpnProviderStatus {
        provider: VpnProviderKind::Embedded,
        state: VpnRuntimeState::Unavailable,
        service_name: TICKETPRO_VPN_SERVICE_NAME,
        service_version: None,
        detail_code: Some(code.to_string()),
        last_handshake_unix_seconds: None,
        rx_bytes: 0,
        tx_bytes: 0,
    }
}

fn map_state(state: Option<&str>) -> VpnRuntimeState {
    match state {
        Some("DISCONNECTED") => VpnRuntimeState::Disconnected,
        Some("CONNECTING") => VpnRuntimeState::Connecting,
        Some("CONNECTED") => VpnRuntimeState::Connected,
        Some("DEGRADED") => VpnRuntimeState::Degraded,
        Some("ERROR") => VpnRuntimeState::Error,
        _ => VpnRuntimeState::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::{map_state, VpnPublicIdentity, VpnRuntimeState};

    #[test]
    fn maps_only_known_service_states() {
        assert_eq!(map_state(Some("CONNECTED")), VpnRuntimeState::Connected);
        assert_eq!(map_state(Some("BOGUS")), VpnRuntimeState::Unavailable);
    }

    #[test]
    fn public_identity_schema_contains_no_private_key() {
        let identity = VpnPublicIdentity {
            installation_id: "2f3d4e5f-1111-4222-8333-123456789abc".to_string(),
            public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".to_string(),
            key_version: 1,
        };
        let json = serde_json::to_string(&identity).expect("serialize public identity");
        assert!(!json.contains("private"));
        assert!(!json.contains("secret"));
    }
}
