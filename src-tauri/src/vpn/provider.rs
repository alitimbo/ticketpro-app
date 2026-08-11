use super::embedded::EmbeddedVpnProvider;
use super::legacy::LegacyVpnProvider;
use super::models::{VpnProviderKind, VpnProviderStatus};

pub const VPN_PROVIDER_ENV: &str = "TICKETPRO_VPN_PROVIDER";

pub trait DesktopVpnProvider: Send + Sync {
    fn status(&self) -> VpnProviderStatus;
}

pub fn selected_provider() -> Box<dyn DesktopVpnProvider> {
    match selected_provider_kind() {
        VpnProviderKind::Embedded => Box::new(EmbeddedVpnProvider),
        VpnProviderKind::Legacy => Box::new(LegacyVpnProvider),
    }
}

fn selected_provider_kind() -> VpnProviderKind {
    match std::env::var(VPN_PROVIDER_ENV) {
        Ok(value) if value.trim().eq_ignore_ascii_case("legacy") => VpnProviderKind::Legacy,
        _ => VpnProviderKind::Embedded,
    }
}

pub fn embedded_provider_selected() -> bool {
    selected_provider_kind() == VpnProviderKind::Embedded
}

#[cfg(test)]
mod tests {
    use super::{selected_provider_kind, VpnProviderKind, VPN_PROVIDER_ENV};
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn embedded_is_the_production_default() {
        let _guard = env_lock().lock().expect("environment lock");
        std::env::remove_var(VPN_PROVIDER_ENV);
        assert_eq!(selected_provider_kind(), VpnProviderKind::Embedded);
    }

    #[test]
    fn legacy_provider_requires_an_explicit_rollback() {
        let _guard = env_lock().lock().expect("environment lock");
        std::env::set_var(VPN_PROVIDER_ENV, "legacy");
        assert_eq!(selected_provider_kind(), VpnProviderKind::Legacy);
        std::env::remove_var(VPN_PROVIDER_ENV);
    }

    #[test]
    fn unknown_values_cannot_silently_disable_the_embedded_provider() {
        let _guard = env_lock().lock().expect("environment lock");
        std::env::set_var(VPN_PROVIDER_ENV, "invalid");
        assert_eq!(selected_provider_kind(), VpnProviderKind::Embedded);
        std::env::remove_var(VPN_PROVIDER_ENV);
    }
}
