use crate::protocol::{ServiceRequest, ServiceResponse};
use crate::tunnel::{NativeTunnelService, PocTunnelService, TunnelService};

pub struct VpnService {
    tunnel: Box<dyn TunnelService>,
    identity: Option<crate::identity::IdentityStore>,
}

impl VpnService {
    pub fn poc() -> Self {
        Self {
            tunnel: Box::new(PocTunnelService),
            identity: None,
        }
    }

    pub fn native() -> Result<Self, &'static str> {
        let directory = crate::identity::data_directory()?;
        let identity = crate::identity::IdentityStore::new(directory.clone());
        Ok(Self {
            tunnel: Box::new(NativeTunnelService::new(identity.clone(), directory)),
            identity: Some(identity),
        })
    }

    pub fn handle(&self, request: ServiceRequest) -> ServiceResponse {
        match request {
            ServiceRequest::GetVersion => ServiceResponse::Version {
                service_version: env!("CARGO_PKG_VERSION"),
            },
            ServiceRequest::GetStatus => ServiceResponse::Status(self.tunnel.status()),
            ServiceRequest::ApplyConfig(config) => match self.tunnel.apply_config(&config) {
                Ok(()) => ServiceResponse::Accepted,
                Err(code) => ServiceResponse::Error { code },
            },
            ServiceRequest::Start => operation_response(self.tunnel.start()),
            ServiceRequest::Stop => operation_response(self.tunnel.stop()),
            ServiceRequest::Repair => operation_response(self.tunnel.repair()),
            ServiceRequest::EnsureIdentity | ServiceRequest::GetPublicIdentity => {
                match self.identity.as_ref() {
                    Some(store) => match store.ensure() {
                        Ok(identity) => ServiceResponse::PublicIdentity(identity),
                        Err(code) => ServiceResponse::Error { code },
                    },
                    None => ServiceResponse::Error {
                        code: "IDENTITY_STORAGE_UNAVAILABLE",
                    },
                }
            }
            ServiceRequest::PrepareIdentityRotation => match self.identity.as_ref() {
                Some(store) => match store.prepare_rotation() {
                    Ok(identity) => ServiceResponse::PublicIdentity(identity),
                    Err(code) => ServiceResponse::Error { code },
                },
                None => ServiceResponse::Error {
                    code: "IDENTITY_STORAGE_UNAVAILABLE",
                },
            },
            ServiceRequest::CommitIdentityRotation => match self.identity.as_ref() {
                Some(store) => operation_response(store.commit_rotation()),
                None => ServiceResponse::Error {
                    code: "IDENTITY_STORAGE_UNAVAILABLE",
                },
            },
            ServiceRequest::AbortIdentityRotation => match self.identity.as_ref() {
                Some(store) => operation_response(store.abort_rotation()),
                None => ServiceResponse::Error {
                    code: "IDENTITY_STORAGE_UNAVAILABLE",
                },
            },
        }
    }
}

fn operation_response(result: Result<(), &'static str>) -> ServiceResponse {
    match result {
        Ok(()) => ServiceResponse::Accepted,
        Err(code) => ServiceResponse::Error { code },
    }
}

#[cfg(test)]
mod tests {
    use super::VpnService;
    use crate::protocol::{ServiceRequest, ServiceResponse};

    #[test]
    fn poc_reports_an_explicit_unavailable_status() {
        let response = VpnService::poc().handle(ServiceRequest::GetStatus);
        match response {
            ServiceResponse::Status(status) => {
                assert_eq!(status.detail_code, Some("WIREGUARD_EMBEDDABLE_NOT_LINKED"));
            }
            _ => panic!("unexpected service response"),
        }
    }

    #[test]
    fn identity_commands_never_return_placeholder_secrets() {
        let response = VpnService::poc().handle(ServiceRequest::GetPublicIdentity);
        assert!(matches!(
            response,
            ServiceResponse::Error {
                code: "IDENTITY_STORAGE_UNAVAILABLE"
            }
        ));
    }
}
