use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zeroize::Zeroizing;

#[cfg(debug_assertions)]
const DATA_DIRECTORY_ENV: &str = "TICKETPRO_VPN_DATA_DIR";
const IDENTITY_FILE: &str = "identity.dat";
const PENDING_IDENTITY_FILE: &str = "identity.pending.dat";
const METADATA_FILE: &str = "metadata.json";
const PAYLOAD_MAGIC: &[u8; 8] = b"TPVPNID1";
const PAYLOAD_LENGTH: usize = 8 + 4 + 16 + 32 + 32;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicIdentity {
    pub installation_id: Uuid,
    pub public_key: String,
    pub key_version: u32,
}

struct SecretIdentity {
    public: PublicIdentity,
    private_key: Zeroizing<[u8; 32]>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySelfTest {
    pub success: bool,
    pub stable_after_reload: bool,
    pub key_version: Option<u32>,
    pub detail_code: Option<&'static str>,
}

pub fn run_identity_self_test() -> IdentitySelfTest {
    let directory = match test_data_directory() {
        Ok(directory) => directory,
        Err(code) => return failed_self_test(code),
    };
    let result = (|| {
        let first = IdentityStore::new(directory.clone()).ensure()?;
        let second = IdentityStore::new(directory.clone()).ensure()?;
        if first != second {
            return Err("IDENTITY_NOT_STABLE");
        }
        Ok(first)
    })();
    let _ = fs::remove_dir_all(&directory);

    match result {
        Ok(identity) => IdentitySelfTest {
            success: true,
            stable_after_reload: true,
            key_version: Some(identity.key_version),
            detail_code: None,
        },
        Err(code) => failed_self_test(code),
    }
}

pub fn run_identity_crypto_self_test() -> Result<(), &'static str> {
    let generated = crate::wireguard_ffi::generate_keypair()?;
    let original = SecretIdentity {
        public: PublicIdentity {
            installation_id: Uuid::new_v4(),
            public_key: BASE64.encode(generated.public_key),
            key_version: 1,
        },
        private_key: generated.private_key,
    };
    let payload = encode_payload(&original)?;
    let protected = crate::dpapi::protect(&payload)?;
    let recovered = crate::dpapi::unprotect(&protected)?;
    let decoded = decode_payload(&recovered)?;
    if decoded.public != original.public
        || decoded.private_key.as_ref() != original.private_key.as_ref()
    {
        return Err("IDENTITY_CRYPTO_ROUNDTRIP_FAILED");
    }
    Ok(())
}

fn failed_self_test(code: &'static str) -> IdentitySelfTest {
    IdentitySelfTest {
        success: false,
        stable_after_reload: false,
        key_version: None,
        detail_code: Some(code),
    }
}

fn test_data_directory() -> Result<PathBuf, &'static str> {
    #[cfg(debug_assertions)]
    {
        let root = std::env::temp_dir().join(format!("ticketpro-vpn-identity-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).map_err(|_| "IDENTITY_DIRECTORY_CREATE_FAILED")?;
        return Ok(root);
    }
    #[allow(unreachable_code)]
    data_directory()
}

pub fn data_directory() -> Result<PathBuf, &'static str> {
    #[cfg(debug_assertions)]
    if let Some(directory) = std::env::var_os(DATA_DIRECTORY_ENV) {
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            return Err("IDENTITY_DIRECTORY_NOT_ABSOLUTE");
        }
        fs::create_dir_all(&directory).map_err(|_| "IDENTITY_DIRECTORY_CREATE_FAILED")?;
        return directory
            .canonicalize()
            .map_err(|_| "IDENTITY_DIRECTORY_UNAVAILABLE");
    }

    let program_data = std::env::var_os("PROGRAMDATA").ok_or("PROGRAMDATA_UNAVAILABLE")?;
    let directory = PathBuf::from(program_data).join("TicketPro").join("vpn");
    fs::create_dir_all(&directory).map_err(|_| "IDENTITY_DIRECTORY_CREATE_FAILED")?;
    directory
        .canonicalize()
        .map_err(|_| "IDENTITY_DIRECTORY_UNAVAILABLE")
}

#[derive(Clone)]
pub struct IdentityStore {
    directory: PathBuf,
}

impl IdentityStore {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn ensure(&self) -> Result<PublicIdentity, &'static str> {
        fs::create_dir_all(&self.directory).map_err(|_| "IDENTITY_DIRECTORY_CREATE_FAILED")?;
        crate::storage_security::protect_path(&self.directory)?;
        let identity_path = self.directory.join(IDENTITY_FILE);
        let metadata_path = self.directory.join(METADATA_FILE);
        if identity_path.exists() {
            crate::storage_security::protect_path(&identity_path)?;
        }
        if metadata_path.exists() {
            crate::storage_security::protect_path(&metadata_path)?;
        }
        match (identity_path.exists(), metadata_path.exists()) {
            (false, false) => self.create(),
            (false, true) => Err("LOCAL_IDENTITY_LOST"),
            (true, _) => {
                let secret = self.load_secret()?;
                if metadata_path.exists() {
                    let metadata = read_metadata(&metadata_path)?;
                    if metadata != secret.public {
                        write_json_atomic(&metadata_path, &secret.public)?;
                    }
                } else {
                    write_json_atomic(&metadata_path, &secret.public)?;
                }
                Ok(secret.public)
            }
        }
    }

    pub fn render_tunnel_config(
        &self,
        config: &crate::models::TunnelConfig,
    ) -> Result<Zeroizing<Vec<u8>>, &'static str> {
        config.validate()?;
        let identity = self.load_secret()?;
        let private_key = Zeroizing::new(BASE64.encode(identity.private_key.as_ref()));
        let mut output = Zeroizing::new(Vec::with_capacity(512));
        writeln!(&mut output, "[Interface]").map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(&mut output, "PrivateKey = {}", private_key.as_str())
            .map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(&mut output, "Address = {}", config.address)
            .map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(&mut output).map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(&mut output, "[Peer]").map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(&mut output, "PublicKey = {}", config.gateway_public_key)
            .map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(
            &mut output,
            "Endpoint = {}:{}",
            config.endpoint_host, config.endpoint_port
        )
        .map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(&mut output, "AllowedIPs = {}", config.allowed_ips.join(", "))
            .map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        writeln!(
            &mut output,
            "PersistentKeepalive = {}",
            config.persistent_keepalive
        )
        .map_err(|_| "TUNNEL_CONFIG_BUILD_FAILED")?;
        Ok(output)
    }

    pub fn prepare_rotation(&self) -> Result<PublicIdentity, &'static str> {
        let current = self.load_secret()?;
        let pending_path = self.directory.join(PENDING_IDENTITY_FILE);
        if pending_path.exists() {
            crate::storage_security::protect_path(&pending_path)?;
            let pending = self.load_secret_from(&pending_path)?;
            validate_pending_rotation(&current, &pending)?;
            return Ok(pending.public);
        }
        let generated = crate::wireguard_ffi::generate_keypair()?;
        let pending = SecretIdentity {
            public: PublicIdentity {
                installation_id: current.public.installation_id,
                public_key: BASE64.encode(generated.public_key),
                key_version: current
                    .public
                    .key_version
                    .checked_add(1)
                    .ok_or("IDENTITY_KEY_VERSION_EXHAUSTED")?,
            },
            private_key: generated.private_key,
        };
        let payload = encode_payload(&pending)?;
        let protected = crate::dpapi::protect(&payload)?;
        write_bytes_new(&pending_path, &protected)?;
        crate::storage_security::protect_path(&pending_path)?;
        Ok(pending.public)
    }

    pub fn commit_rotation(&self) -> Result<(), &'static str> {
        let current = self.load_secret()?;
        let pending_path = self.directory.join(PENDING_IDENTITY_FILE);
        if !pending_path.is_file() {
            return Err("IDENTITY_ROTATION_NOT_PREPARED");
        }
        let pending = self.load_secret_from(&pending_path)?;
        validate_pending_rotation(&current, &pending)?;
        replace_file_atomic(&pending_path, &self.directory.join(IDENTITY_FILE))?;
        crate::storage_security::protect_path(&self.directory.join(IDENTITY_FILE))?;
        write_json_atomic(&self.directory.join(METADATA_FILE), &pending.public)?;
        crate::storage_security::protect_path(&self.directory.join(METADATA_FILE))?;
        Ok(())
    }

    pub fn abort_rotation(&self) -> Result<(), &'static str> {
        let pending_path = self.directory.join(PENDING_IDENTITY_FILE);
        if pending_path.exists() {
            fs::remove_file(pending_path).map_err(|_| "IDENTITY_ROTATION_ABORT_FAILED")?;
        }
        Ok(())
    }

    fn create(&self) -> Result<PublicIdentity, &'static str> {
        let generated = crate::wireguard_ffi::generate_keypair()?;
        let secret = SecretIdentity {
            public: PublicIdentity {
                installation_id: Uuid::new_v4(),
                public_key: BASE64.encode(generated.public_key),
                key_version: 1,
            },
            private_key: generated.private_key,
        };
        let payload = encode_payload(&secret)?;
        let protected = crate::dpapi::protect(&payload)?;
        write_bytes_new(&self.directory.join(IDENTITY_FILE), &protected)?;
        write_json_atomic(&self.directory.join(METADATA_FILE), &secret.public)?;
        crate::storage_security::protect_path(&self.directory.join(IDENTITY_FILE))?;
        crate::storage_security::protect_path(&self.directory.join(METADATA_FILE))?;
        Ok(secret.public)
    }

    fn load_secret(&self) -> Result<SecretIdentity, &'static str> {
        self.load_secret_from(&self.directory.join(IDENTITY_FILE))
    }

    fn load_secret_from(&self, path: &Path) -> Result<SecretIdentity, &'static str> {
        let protected = fs::read(path).map_err(|_| "IDENTITY_READ_FAILED")?;
        let payload = crate::dpapi::unprotect(&protected)?;
        decode_payload(&payload)
    }
}

fn validate_pending_rotation(
    current: &SecretIdentity,
    pending: &SecretIdentity,
) -> Result<(), &'static str> {
    if pending.public.installation_id != current.public.installation_id
        || pending.public.key_version != current.public.key_version.saturating_add(1)
        || pending.public.public_key == current.public.public_key
    {
        return Err("IDENTITY_ROTATION_INVALID");
    }
    Ok(())
}

fn encode_payload(identity: &SecretIdentity) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    let public_key = BASE64
        .decode(identity.public.public_key.as_bytes())
        .map_err(|_| "IDENTITY_PUBLIC_KEY_INVALID")?;
    if public_key.len() != 32 || identity.public.key_version == 0 {
        return Err("IDENTITY_PAYLOAD_INVALID");
    }
    let mut payload = Zeroizing::new(Vec::with_capacity(PAYLOAD_LENGTH));
    payload.extend_from_slice(PAYLOAD_MAGIC);
    payload.extend_from_slice(&identity.public.key_version.to_le_bytes());
    payload.extend_from_slice(identity.public.installation_id.as_bytes());
    payload.extend_from_slice(&public_key);
    payload.extend_from_slice(identity.private_key.as_ref());
    Ok(payload)
}

fn decode_payload(payload: &[u8]) -> Result<SecretIdentity, &'static str> {
    if payload.len() != PAYLOAD_LENGTH || &payload[..8] != PAYLOAD_MAGIC {
        return Err("LOCAL_IDENTITY_CORRUPT");
    }
    let key_version = u32::from_le_bytes(
        payload[8..12]
            .try_into()
            .map_err(|_| "LOCAL_IDENTITY_CORRUPT")?,
    );
    if key_version == 0 {
        return Err("LOCAL_IDENTITY_CORRUPT");
    }
    let installation_id =
        Uuid::from_slice(&payload[12..28]).map_err(|_| "LOCAL_IDENTITY_CORRUPT")?;
    let public_bytes: [u8; 32] = payload[28..60]
        .try_into()
        .map_err(|_| "LOCAL_IDENTITY_CORRUPT")?;
    let private_key: [u8; 32] = payload[60..92]
        .try_into()
        .map_err(|_| "LOCAL_IDENTITY_CORRUPT")?;
    if public_bytes.iter().all(|byte| *byte == 0) || private_key.iter().all(|byte| *byte == 0) {
        return Err("LOCAL_IDENTITY_CORRUPT");
    }
    Ok(SecretIdentity {
        public: PublicIdentity {
            installation_id,
            public_key: BASE64.encode(public_bytes),
            key_version,
        },
        private_key: Zeroizing::new(private_key),
    })
}

fn read_metadata(path: &Path) -> Result<PublicIdentity, &'static str> {
    let bytes = fs::read(path).map_err(|_| "IDENTITY_METADATA_READ_FAILED")?;
    if bytes.len() > 4096 {
        return Err("IDENTITY_METADATA_INVALID");
    }
    serde_json::from_slice(&bytes).map_err(|_| "IDENTITY_METADATA_INVALID")
}

fn write_bytes_new(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "IDENTITY_WRITE_FAILED")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "IDENTITY_WRITE_FAILED")
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| "IDENTITY_METADATA_INVALID")?;
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    write_bytes_new(&temporary, &bytes)?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| "IDENTITY_METADATA_WRITE_FAILED")?;
    }
    fs::rename(&temporary, path).map_err(|_| "IDENTITY_METADATA_WRITE_FAILED")
}

#[cfg(windows)]
fn replace_file_atomic(source: &Path, destination: &Path) -> Result<(), &'static str> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err("IDENTITY_ROTATION_COMMIT_FAILED")
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomic(_source: &Path, _destination: &Path) -> Result<(), &'static str> {
    Err("WINDOWS_REQUIRED")
}

#[cfg(test)]
mod tests {
    use super::{decode_payload, encode_payload, PublicIdentity, SecretIdentity, PAYLOAD_LENGTH};
    use uuid::Uuid;
    use zeroize::Zeroizing;

    fn identity() -> SecretIdentity {
        SecretIdentity {
            public: PublicIdentity {
                installation_id: Uuid::new_v4(),
                public_key: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=".to_string(),
                key_version: 1,
            },
            private_key: Zeroizing::new([2_u8; 32]),
        }
    }

    #[test]
    fn binary_payload_round_trips_without_serializing_the_private_key() {
        let original = identity();
        let payload = encode_payload(&original).expect("encode identity");
        assert_eq!(payload.len(), PAYLOAD_LENGTH);
        let decoded = decode_payload(&payload).expect("decode identity");
        assert_eq!(decoded.public, original.public);
        assert_eq!(decoded.private_key.as_ref(), original.private_key.as_ref());
    }

    #[test]
    fn corrupted_payload_is_never_accepted() {
        assert_eq!(
            decode_payload(&[0_u8; 92]).err(),
            Some("LOCAL_IDENTITY_CORRUPT")
        );
    }
}
