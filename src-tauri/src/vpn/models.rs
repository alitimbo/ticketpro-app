use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VpnProviderKind {
    Legacy,
    Embedded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
// Le protocole expose des maintenant les etats cibles afin de rester stable
// pendant l'integration du service. Le provider legacy n'en produit que deux.
#[allow(dead_code)]
pub enum VpnRuntimeState {
    Unavailable,
    Installing,
    Disconnected,
    Connecting,
    Connected,
    Degraded,
    Revoked,
    SubscriptionRequired,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnProviderStatus {
    pub provider: VpnProviderKind,
    pub state: VpnRuntimeState,
    pub service_name: &'static str,
    pub service_version: Option<String>,
    pub detail_code: Option<String>,
    pub last_handshake_unix_seconds: Option<u64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VpnPublicIdentity {
    pub installation_id: String,
    pub public_key: String,
    pub key_version: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VpnTunnelConfig {
    pub config_version: u64,
    pub address: String,
    pub gateway_public_key: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: u16,
}

impl VpnTunnelConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.config_version == 0
            || !is_private_ipv4_cidr(&self.address)
            || self.gateway_public_key.len() != 44
            || !self
                .gateway_public_key
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '+' | '/' | '='))
            || !is_valid_endpoint_host(&self.endpoint_host)
            || self.endpoint_port == 0
            || self.allowed_ips.is_empty()
            || self.allowed_ips.len() > 16
            || self.allowed_ips.iter().any(|route| {
                matches!(route.as_str(), "0.0.0.0/0" | "::/0") || !is_private_ipv4_cidr(route)
            })
            || !(5..=300).contains(&self.persistent_keepalive)
        {
            return Err("VPN_TUNNEL_CONFIG_INVALID");
        }
        Ok(())
    }
}

fn is_valid_endpoint_host(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && !value.starts_with('.')
        && !value.ends_with('.')
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
}

fn is_private_ipv4_cidr(value: &str) -> bool {
    let Some((address, prefix)) = value.split_once('/') else {
        return false;
    };
    let Ok(prefix) = prefix.parse::<u8>() else {
        return false;
    };
    prefix <= 32
        && address
            .parse::<std::net::Ipv4Addr>()
            .is_ok_and(|address| address.is_private())
}
