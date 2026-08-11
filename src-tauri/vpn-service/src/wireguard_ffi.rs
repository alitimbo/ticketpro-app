use serde::Serialize;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

#[cfg(debug_assertions)]
const COMPONENT_DIRECTORY_ENV: &str = "TICKETPRO_VPN_COMPONENT_DIR";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSelfTest {
    pub success: bool,
    pub component_architecture: &'static str,
    pub key_generation_available: bool,
    pub detail_code: Option<&'static str>,
}

pub fn run_component_self_test() -> ComponentSelfTest {
    let component_architecture = std::env::consts::ARCH;
    let result = component_directory().and_then(|directory| platform::self_test(&directory));
    match result {
        Ok(()) => ComponentSelfTest {
            success: true,
            component_architecture,
            key_generation_available: true,
            detail_code: None,
        },
        Err(code) => ComponentSelfTest {
            success: false,
            component_architecture,
            key_generation_available: false,
            detail_code: Some(code),
        },
    }
}

pub struct GeneratedKeypair {
    pub public_key: [u8; 32],
    pub private_key: Zeroizing<[u8; 32]>,
}

pub struct AdapterTelemetry {
    pub adapter_up: bool,
    pub last_handshake_unix_seconds: Option<u64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

pub fn adapter_telemetry() -> Result<AdapterTelemetry, &'static str> {
    let directory = component_directory()?;
    platform::adapter_telemetry(&directory)
}

pub fn generate_keypair() -> Result<GeneratedKeypair, &'static str> {
    let directory = component_directory()?;
    platform::generate_keypair(&directory)
}

pub fn run_tunnel_service(config_path: &Path) -> Result<(), &'static str> {
    if !config_path.is_absolute()
        || !config_path.is_file()
        || config_path.file_name().and_then(|name| name.to_str())
            != Some("TicketProTunnel.conf.dpapi")
    {
        return Err("TUNNEL_CONFIG_PATH_INVALID");
    }
    let directory = component_directory()?;
    platform::run_tunnel_service(&directory, config_path)
}

fn component_directory() -> Result<PathBuf, &'static str> {
    #[cfg(debug_assertions)]
    if let Some(directory) = std::env::var_os(COMPONENT_DIRECTORY_ENV) {
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            return Err("COMPONENT_DIRECTORY_NOT_ABSOLUTE");
        }
        return directory
            .canonicalize()
            .map_err(|_| "COMPONENT_DIRECTORY_UNAVAILABLE");
    }

    let executable = std::env::current_exe().map_err(|_| "EXECUTABLE_PATH_UNAVAILABLE")?;
    let directory = executable
        .parent()
        .ok_or("EXECUTABLE_DIRECTORY_UNAVAILABLE")?
        .join("vpn");
    directory
        .canonicalize()
        .map_err(|_| "COMPONENT_DIRECTORY_UNAVAILABLE")
}

#[cfg(windows)]
mod platform {
    use super::GeneratedKeypair;
    use super::Path;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::HMODULE;
    use windows_sys::Win32::Networking::WinSock::SOCKADDR_INET;
    use windows_sys::Win32::System::LibraryLoader::{
        GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
        LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    use zeroize::Zeroizing;

    type GenerateKeypair = unsafe extern "C" fn(public_key: *mut u8, private_key: *mut u8);
    type RunTunnelService = unsafe extern "C" fn(config_path: *const u16) -> i32;
    type OpenAdapter = unsafe extern "system" fn(name: *const u16) -> *mut c_void;
    type CloseAdapter = unsafe extern "system" fn(adapter: *mut c_void);
    type GetAdapterState = unsafe extern "system" fn(adapter: *mut c_void, state: *mut u32) -> i32;
    type GetConfiguration = unsafe extern "system" fn(
        adapter: *mut c_void,
        config: *mut WireGuardInterface,
        bytes: *mut u32,
    ) -> i32;

    #[repr(C, align(8))]
    struct WireGuardInterface {
        flags: u32,
        listen_port: u16,
        private_key: [u8; 32],
        public_key: [u8; 32],
        peers_count: u32,
    }

    #[repr(C, align(8))]
    struct WireGuardPeer {
        flags: u32,
        reserved: u32,
        public_key: [u8; 32],
        preshared_key: [u8; 32],
        persistent_keepalive: u16,
        endpoint: SOCKADDR_INET,
        tx_bytes: u64,
        rx_bytes: u64,
        last_handshake: u64,
        allowed_ips_count: u32,
    }

    #[repr(C, align(8))]
    struct WireGuardAllowedIp {
        address: [u8; 16],
        address_family: u16,
        cidr: u8,
        flags: u32,
    }

    static COMPONENTS: OnceLock<Result<ComponentApi, &'static str>> = OnceLock::new();

    pub fn self_test(directory: &Path) -> Result<(), &'static str> {
        let _keypair = generate_keypair(directory)?;
        Ok(())
    }

    pub fn generate_keypair(directory: &Path) -> Result<GeneratedKeypair, &'static str> {
        if !directory.is_dir() {
            return Err("COMPONENT_DIRECTORY_UNAVAILABLE");
        }

        let components = COMPONENTS
            .get_or_init(|| ComponentApi::load(directory))
            .as_ref()
            .map_err(|code| *code)?;

        let mut public_key = [0_u8; 32];
        let mut private_key = Zeroizing::new([0_u8; 32]);
        unsafe {
            (components.generate_keypair)(public_key.as_mut_ptr(), private_key.as_mut_ptr());
        }

        if public_key.iter().all(|byte| *byte == 0) || private_key.iter().all(|byte| *byte == 0) {
            return Err("KEY_GENERATION_FAILED");
        }
        Ok(GeneratedKeypair {
            public_key,
            private_key,
        })
    }

    pub fn run_tunnel_service(
        directory: &Path,
        config_path: &Path,
    ) -> Result<(), &'static str> {
        let components = COMPONENTS
            .get_or_init(|| ComponentApi::load(directory))
            .as_ref()
            .map_err(|code| *code)?;
        let wide_path = config_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let success = unsafe { (components.run_tunnel_service)(wide_path.as_ptr()) };
        if success == 0 {
            Err("TUNNEL_SERVICE_FAILED")
        } else {
            Ok(())
        }
    }

    pub fn adapter_telemetry(directory: &Path) -> Result<super::AdapterTelemetry, &'static str> {
        let components = COMPONENTS
            .get_or_init(|| ComponentApi::load(directory))
            .as_ref()
            .map_err(|code| *code)?;
        let name = std::ffi::OsStr::new(crate::models::TUNNEL_NAME)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let adapter = unsafe { (components.open_adapter)(name.as_ptr()) };
        if adapter.is_null() {
            return Err("WIREGUARD_ADAPTER_NOT_FOUND");
        }
        let adapter = AdapterGuard {
            handle: adapter,
            close: components.close_adapter,
        };
        let mut state = 0_u32;
        if unsafe { (components.get_adapter_state)(adapter.handle, &mut state) } == 0 {
            return Err("WIREGUARD_ADAPTER_STATE_FAILED");
        }
        let mut bytes = 0_u32;
        unsafe {
            (components.get_configuration)(adapter.handle, std::ptr::null_mut(), &mut bytes)
        };
        if bytes < std::mem::size_of::<WireGuardInterface>() as u32
            || bytes > 1024 * 1024
        {
            return Err("WIREGUARD_CONFIGURATION_SIZE_INVALID");
        }
        let words = (bytes as usize).div_ceil(std::mem::size_of::<u64>());
        // WireGuardGetConfiguration inclut aussi la cle privee de l'interface.
        // Le buffer complet doit donc etre efface des sa sortie de portee.
        let mut buffer = Zeroizing::new(vec![0_u64; words]);
        if unsafe {
            (components.get_configuration)(
                adapter.handle,
                buffer.as_mut_ptr() as *mut WireGuardInterface,
                &mut bytes,
            )
        } == 0
        {
            return Err("WIREGUARD_CONFIGURATION_READ_FAILED");
        }
        parse_telemetry(&buffer, bytes as usize, state == 1)
    }

    fn parse_telemetry(
        buffer: &[u64],
        bytes: usize,
        adapter_up: bool,
    ) -> Result<super::AdapterTelemetry, &'static str> {
        if bytes < std::mem::size_of::<WireGuardInterface>() || bytes > buffer.len() * 8 {
            return Err("WIREGUARD_CONFIGURATION_INVALID");
        }
        let base = buffer.as_ptr() as *const u8;
        let interface = unsafe { &*(base as *const WireGuardInterface) };
        if interface.peers_count > 64 {
            return Err("WIREGUARD_PEER_COUNT_INVALID");
        }
        let mut offset = std::mem::size_of::<WireGuardInterface>();
        let mut latest_handshake = 0_u64;
        let mut rx_bytes = 0_u64;
        let mut tx_bytes = 0_u64;
        for _ in 0..interface.peers_count {
            if offset + std::mem::size_of::<WireGuardPeer>() > bytes {
                return Err("WIREGUARD_CONFIGURATION_INVALID");
            }
            let peer = unsafe { &*(base.add(offset) as *const WireGuardPeer) };
            latest_handshake = latest_handshake.max(peer.last_handshake);
            rx_bytes = rx_bytes.saturating_add(peer.rx_bytes);
            tx_bytes = tx_bytes.saturating_add(peer.tx_bytes);
            let allowed_bytes = (peer.allowed_ips_count as usize)
                .checked_mul(std::mem::size_of::<WireGuardAllowedIp>())
                .ok_or("WIREGUARD_CONFIGURATION_INVALID")?;
            offset = offset
                .checked_add(std::mem::size_of::<WireGuardPeer>())
                .and_then(|offset| offset.checked_add(allowed_bytes))
                .ok_or("WIREGUARD_CONFIGURATION_INVALID")?;
        }
        if offset > bytes {
            return Err("WIREGUARD_CONFIGURATION_INVALID");
        }
        Ok(super::AdapterTelemetry {
            adapter_up,
            last_handshake_unix_seconds: filetime_to_unix(latest_handshake),
            rx_bytes,
            tx_bytes,
        })
    }

    fn filetime_to_unix(value: u64) -> Option<u64> {
        const WINDOWS_TO_UNIX_SECONDS: u64 = 11_644_473_600;
        if value == 0 {
            return None;
        }
        (value / 10_000_000).checked_sub(WINDOWS_TO_UNIX_SECONDS)
    }

    struct LoadedLibrary(HMODULE);

    // Les handles sont immuables apres chargement et conserves jusqu'a la fin
    // du processus. Les exports appeles sont eux-memes thread-safe.
    unsafe impl Send for LoadedLibrary {}
    unsafe impl Sync for LoadedLibrary {}

    struct ComponentApi {
        _wireguard: LoadedLibrary,
        _tunnel: LoadedLibrary,
        generate_keypair: GenerateKeypair,
        run_tunnel_service: RunTunnelService,
        open_adapter: OpenAdapter,
        close_adapter: CloseAdapter,
        get_adapter_state: GetAdapterState,
        get_configuration: GetConfiguration,
    }

    impl ComponentApi {
        fn load(directory: &Path) -> Result<Self, &'static str> {
            // wireguard.dll est charge explicitement depuis le meme repertoire
            // afin d'eviter le current working directory et le DLL preloading.
            let wireguard = LoadedLibrary::load(&directory.join("wireguard.dll"), "WIREGUARD_DLL")?;
            let tunnel = LoadedLibrary::load(&directory.join("tunnel.dll"), "TUNNEL_DLL")?;
            let generate_keypair = unsafe { tunnel.function(b"WireGuardGenerateKeypair\0")? };
            let run_tunnel_service = unsafe { tunnel.function(b"WireGuardTunnelService\0")? };
            let open_adapter = unsafe { wireguard.function(b"WireGuardOpenAdapter\0")? };
            let close_adapter = unsafe { wireguard.function(b"WireGuardCloseAdapter\0")? };
            let get_adapter_state = unsafe { wireguard.function(b"WireGuardGetAdapterState\0")? };
            let get_configuration = unsafe { wireguard.function(b"WireGuardGetConfiguration\0")? };
            Ok(Self {
                _wireguard: wireguard,
                _tunnel: tunnel,
                generate_keypair,
                run_tunnel_service,
                open_adapter,
                close_adapter,
                get_adapter_state,
                get_configuration,
            })
        }
    }

    struct AdapterGuard {
        handle: *mut c_void,
        close: CloseAdapter,
    }

    impl Drop for AdapterGuard {
        fn drop(&mut self) {
            unsafe { (self.close)(self.handle) };
        }
    }

    impl LoadedLibrary {
        fn load(path: &Path, error_prefix: &'static str) -> Result<Self, &'static str> {
            if !path.is_file() {
                return Err(match error_prefix {
                    "WIREGUARD_DLL" => "WIREGUARD_DLL_MISSING",
                    _ => "TUNNEL_DLL_MISSING",
                });
            }
            let wide = path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            let handle = unsafe {
                LoadLibraryExW(
                    wide.as_ptr(),
                    std::ptr::null_mut(),
                    LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
                )
            };
            if handle.is_null() {
                return Err(match error_prefix {
                    "WIREGUARD_DLL" => "WIREGUARD_DLL_LOAD_FAILED",
                    _ => "TUNNEL_DLL_LOAD_FAILED",
                });
            }
            Ok(Self(handle))
        }

        unsafe fn function<T>(&self, name: &[u8]) -> Result<T, &'static str>
        where
            T: Copy,
        {
            let function = GetProcAddress(self.0, name.as_ptr());
            let Some(function) = function else {
                return Err("TUNNEL_EXPORT_MISSING");
            };
            if std::mem::size_of::<T>() != std::mem::size_of::<*const c_void>() {
                return Err("TUNNEL_EXPORT_TYPE_INVALID");
            }
            Ok(std::mem::transmute_copy(&function))
        }
    }

    #[cfg(test)]
    mod abi_tests {
        use super::{
            filetime_to_unix, WireGuardAllowedIp, WireGuardInterface, WireGuardPeer,
        };

        #[test]
        fn wireguard_nt_struct_layout_matches_the_official_header() {
            assert_eq!(std::mem::size_of::<WireGuardInterface>(), 80);
            assert_eq!(std::mem::offset_of!(WireGuardInterface, private_key), 6);
            assert_eq!(std::mem::offset_of!(WireGuardInterface, peers_count), 72);
            assert_eq!(std::mem::size_of::<WireGuardPeer>(), 136);
            assert_eq!(std::mem::offset_of!(WireGuardPeer, endpoint), 76);
            assert_eq!(std::mem::offset_of!(WireGuardPeer, tx_bytes), 104);
            assert_eq!(std::mem::offset_of!(WireGuardPeer, last_handshake), 120);
            assert_eq!(std::mem::offset_of!(WireGuardPeer, allowed_ips_count), 128);
            assert_eq!(std::mem::size_of::<WireGuardAllowedIp>(), 24);
        }

        #[test]
        fn converts_windows_filetime_without_accepting_zero() {
            assert_eq!(filetime_to_unix(0), None);
            assert_eq!(filetime_to_unix(116_444_736_000_000_000), Some(0));
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{GeneratedKeypair, Path};

    pub fn self_test(_directory: &Path) -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }

    pub fn generate_keypair(_directory: &Path) -> Result<GeneratedKeypair, &'static str> {
        Err("WINDOWS_REQUIRED")
    }

    pub fn run_tunnel_service(
        _directory: &Path,
        _config_path: &Path,
    ) -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }

    pub fn adapter_telemetry(
        _directory: &Path,
    ) -> Result<super::AdapterTelemetry, &'static str> {
        Err("WINDOWS_REQUIRED")
    }
}

#[cfg(test)]
mod tests {
    use super::component_directory;

    #[test]
    fn component_directory_is_never_relative() {
        if let Ok(directory) = component_directory() {
            assert!(directory.is_absolute());
        }
    }
}
