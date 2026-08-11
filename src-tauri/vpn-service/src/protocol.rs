use crate::models::{TunnelConfig, TunnelStatus};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(
    tag = "command",
    content = "payload",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum ServiceRequest {
    GetVersion,
    GetStatus,
    EnsureIdentity,
    GetPublicIdentity,
    ApplyConfig(TunnelConfig),
    Start,
    Stop,
    Repair,
    PrepareIdentityRotation,
    CommitIdentityRotation,
    AbortIdentityRotation,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceResponse {
    Version { service_version: &'static str },
    Status(TunnelStatus),
    PublicIdentity(crate::identity::PublicIdentity),
    Accepted,
    Error { code: &'static str },
}
