use serde::{Deserialize, Serialize};

pub const SERVICE_NAME: &str = "TicketProVpnService";
pub const TUNNEL_NAME: &str = "TicketProTunnel";
// Utilisee par la configuration SaaS a la phase d'enregistrement du device.
// Le binaire POC ne construit pas encore lui-meme cette configuration.
#[allow(dead_code)]
pub const DEFAULT_KEEPALIVE_SECONDS: u16 = 25;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
// Tous ces etats font partie du protocole stable du service. Le POC ne peut
// encore produire que `Unavailable` tant que tunnel.dll n'est pas relie.
#[allow(dead_code)]
pub enum TunnelState {
    Unavailable,
    Disconnected,
    Connecting,
    Connected,
    Degraded,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub state: TunnelState,
    pub service_name: &'static str,
    pub tunnel_name: &'static str,
    pub service_version: &'static str,
    pub detail_code: Option<&'static str>,
    pub last_handshake_unix_seconds: Option<u64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TunnelConfig {
    pub config_version: u64,
    pub address: String,
    pub gateway_public_key: String,
    pub endpoint_host: String,
    pub endpoint_port: u16,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: u16,
}

impl TunnelConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.config_version == 0 {
            return Err("CONFIG_VERSION_INVALID");
        }
        if !is_private_ipv4_cidr(&self.address) {
            return Err("ADDRESS_INVALID");
        }
        if self.gateway_public_key.len() != 44
            || !self
                .gateway_public_key
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '+' | '/' | '='))
        {
            return Err("GATEWAY_PUBLIC_KEY_INVALID");
        }
        if !is_valid_endpoint_host(&self.endpoint_host) || self.endpoint_port == 0 {
            return Err("ENDPOINT_INVALID");
        }
        if self.allowed_ips.is_empty()
            || self.allowed_ips.len() > 16
            || self.allowed_ips.iter().any(|route| {
                route == "0.0.0.0/0" || route == "::/0" || !is_private_ipv4_cidr(route)
            })
        {
            return Err("ALLOWED_IPS_INVALID");
        }
        if !(5..=300).contains(&self.persistent_keepalive) {
            return Err("KEEPALIVE_INVALID");
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
    if prefix > 32 {
        return false;
    }
    let Ok(address) = address.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    address.is_private()
}

#[cfg(test)]
mod tests {
    use super::{TunnelConfig, DEFAULT_KEEPALIVE_SECONDS};

    fn valid_config() -> TunnelConfig {
        TunnelConfig {
            config_version: 1,
            address: "10.250.10.21/32".to_string(),
            gateway_public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".to_string(),
            endpoint_host: "vpn.autoticket-ne.com".to_string(),
            endpoint_port: 51820,
            allowed_ips: vec!["10.250.0.0/16".to_string()],
            persistent_keepalive: DEFAULT_KEEPALIVE_SECONDS,
        }
    }

    #[test]
    fn accepts_a_split_tunnel_configuration() {
        assert_eq!(valid_config().validate(), Ok(()));
    }

    #[test]
    fn rejects_a_full_tunnel_route() {
        let mut config = valid_config();
        config.allowed_ips = vec!["0.0.0.0/0".to_string()];
        assert_eq!(config.validate(), Err("ALLOWED_IPS_INVALID"));
    }

    #[test]
    fn rejects_an_endpoint_with_a_path_or_scheme() {
        let mut config = valid_config();
        config.endpoint_host = "https://vpn.autoticket-ne.com/config".to_string();
        assert_eq!(config.validate(), Err("ENDPOINT_INVALID"));
    }
}
