use crate::protocol::{ServiceRequest, ServiceResponse};

pub const PIPE_NAME: &str = r"\\.\pipe\TicketProVpnService.v1";
const MAX_MESSAGE_BYTES: usize = 64 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcSelfTest {
    pub success: bool,
    pub pipe_name: &'static str,
    pub detail_code: Option<&'static str>,
}

#[cfg(windows)]
pub fn run_self_test() -> IpcSelfTest {
    platform::run_self_test()
}

#[cfg(not(windows))]
pub fn run_self_test() -> IpcSelfTest {
    IpcSelfTest {
        success: false,
        pipe_name: PIPE_NAME,
        detail_code: Some("WINDOWS_REQUIRED"),
    }
}

fn decode_request(payload: &[u8]) -> Result<ServiceRequest, &'static str> {
    if payload.is_empty() || payload.len() > MAX_MESSAGE_BYTES {
        return Err("IPC_MESSAGE_SIZE_INVALID");
    }
    serde_json::from_slice(payload).map_err(|_| "IPC_REQUEST_INVALID")
}

fn encode_response(response: &ServiceResponse) -> Result<Vec<u8>, &'static str> {
    let payload = serde_json::to_vec(response).map_err(|_| "IPC_RESPONSE_SERIALIZE_FAILED")?;
    if payload.len() > MAX_MESSAGE_BYTES {
        return Err("IPC_RESPONSE_TOO_LARGE");
    }
    Ok(payload)
}

#[cfg(windows)]
pub fn run_server(
    service: crate::service::VpnService,
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    platform::run_server(service, shutdown);
}

#[cfg(not(windows))]
pub fn run_server(
    _service: crate::service::VpnService,
    _shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
}

#[cfg(windows)]
pub fn wake_server() {
    platform::wake_server();
}

#[cfg(not(windows))]
pub fn wake_server() {}

#[cfg(windows)]
mod platform {
    use super::{decode_request, encode_response, PIPE_NAME};
    use crate::protocol::ServiceResponse;
    use crate::service::VpnService;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, ERROR_PIPE_CONNECTED, GENERIC_READ, GENERIC_WRITE,
        HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FlushFileBuffers, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE,
        OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
    };
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, WaitNamedPipeW,
        PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT,
    };

    // LocalSystem and Administrators fully control the pipe. Interactive local
    // users may only read/write it. Remote clients, anonymous users, Everyone
    // and service accounts are intentionally absent.
    pub(super) const PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)";

    pub fn run_server(service: VpnService, shutdown: Arc<AtomicBool>) {
        while !shutdown.load(Ordering::Acquire) {
            let Ok(pipe) = create_pipe() else {
                break;
            };
            let connected = unsafe { ConnectNamedPipe(pipe.0, std::ptr::null_mut()) };
            if connected == 0 && unsafe { GetLastError() } != ERROR_PIPE_CONNECTED {
                continue;
            }
            if shutdown.load(Ordering::Acquire) {
                unsafe { DisconnectNamedPipe(pipe.0) };
                break;
            }
            serve_one(pipe.0, &service);
            unsafe {
                FlushFileBuffers(pipe.0);
                DisconnectNamedPipe(pipe.0);
            }
        }
    }

    pub fn run_self_test() -> super::IpcSelfTest {
        let shutdown = Arc::new(AtomicBool::new(false));
        let server_shutdown = Arc::clone(&shutdown);
        let server = std::thread::spawn(move || {
            run_server(crate::service::VpnService::poc(), server_shutdown)
        });
        let result = call_self_test();
        shutdown.store(true, Ordering::Release);
        wake_server();
        let _ = server.join();
        match result {
            Ok(()) => super::IpcSelfTest {
                success: true,
                pipe_name: PIPE_NAME,
                detail_code: None,
            },
            Err(code) => super::IpcSelfTest {
                success: false,
                pipe_name: PIPE_NAME,
                detail_code: Some(code),
            },
        }
    }

    fn call_self_test() -> Result<(), &'static str> {
        let pipe_name = wide(PIPE_NAME);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            if unsafe { WaitNamedPipeW(pipe_name.as_ptr(), 100) } != 0 {
                break;
            }
            if std::time::Instant::now() >= deadline {
                return Err("IPC_SELF_TEST_PIPE_UNAVAILABLE");
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let payload = br#"{"command":"GET_VERSION"}"#;
        let mut request = Vec::with_capacity(payload.len() + 4);
        request.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        request.extend_from_slice(payload);
        let handle = unsafe {
            CreateFileW(
                pipe_name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err("IPC_SELF_TEST_EXCHANGE_FAILED");
        }
        let handle = HandleGuard(handle);
        write_all(handle.0, &request)?;
        let mut header = [0_u8; 4];
        read_exact(handle.0, &mut header)?;
        let length = u32::from_le_bytes(header) as usize;
        if length == 0 || length > super::MAX_MESSAGE_BYTES {
            return Err("IPC_SELF_TEST_RESPONSE_INVALID");
        }
        let mut response = vec![0_u8; length];
        read_exact(handle.0, &mut response)?;
        let value: serde_json::Value = serde_json::from_slice(&response)
            .map_err(|_| "IPC_SELF_TEST_RESPONSE_INVALID")?;
        if value.get("type").and_then(serde_json::Value::as_str) != Some("VERSION") {
            return Err("IPC_SELF_TEST_RESPONSE_INVALID");
        }
        Ok(())
    }

    pub fn wake_server() {
        let pipe_name = wide(PIPE_NAME);
        let handle = unsafe {
            CreateFileW(
                pipe_name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(handle) };
        }
    }

    fn create_pipe() -> Result<HandleGuard, ()> {
        let descriptor = SecurityDescriptor::from_sddl(PIPE_SDDL)?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        let pipe_name = wide(PIPE_NAME);
        let handle = unsafe {
            CreateNamedPipeW(
                pipe_name.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                super::MAX_MESSAGE_BYTES as u32 + 4,
                super::MAX_MESSAGE_BYTES as u32 + 4,
                0,
                &attributes,
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            Err(())
        } else {
            Ok(HandleGuard(handle))
        }
    }

    fn serve_one(handle: HANDLE, service: &VpnService) {
        let response = match read_frame(handle).and_then(|payload| decode_request(&payload)) {
            Ok(request) => service.handle(request),
            Err(code) => ServiceResponse::Error { code },
        };
        if let Ok(payload) = encode_response(&response) {
            let _ = write_frame(handle, &payload);
        }
    }

    fn read_frame(handle: HANDLE) -> Result<Vec<u8>, &'static str> {
        let mut header = [0u8; 4];
        read_exact(handle, &mut header)?;
        let length = u32::from_le_bytes(header) as usize;
        if length == 0 || length > super::MAX_MESSAGE_BYTES {
            return Err("IPC_MESSAGE_SIZE_INVALID");
        }
        let mut payload = vec![0u8; length];
        read_exact(handle, &mut payload)?;
        Ok(payload)
    }

    fn write_frame(handle: HANDLE, payload: &[u8]) -> Result<(), &'static str> {
        write_all(handle, &(payload.len() as u32).to_le_bytes())?;
        write_all(handle, payload)
    }

    fn read_exact(handle: HANDLE, mut destination: &mut [u8]) -> Result<(), &'static str> {
        while !destination.is_empty() {
            let mut read = 0u32;
            let success = unsafe {
                ReadFile(
                    handle,
                    destination.as_mut_ptr(),
                    destination.len() as u32,
                    &mut read,
                    std::ptr::null_mut(),
                )
            };
            if success == 0 || read == 0 {
                return Err("IPC_READ_FAILED");
            }
            destination = &mut destination[read as usize..];
        }
        Ok(())
    }

    fn write_all(handle: HANDLE, mut source: &[u8]) -> Result<(), &'static str> {
        while !source.is_empty() {
            let mut written = 0u32;
            let success = unsafe {
                WriteFile(
                    handle,
                    source.as_ptr(),
                    source.len() as u32,
                    &mut written,
                    std::ptr::null_mut(),
                )
            };
            if success == 0 || written == 0 {
                return Err("IPC_WRITE_FAILED");
            }
            source = &source[written as usize..];
        }
        Ok(())
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    struct HandleGuard(HANDLE);

    impl Drop for HandleGuard {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    struct SecurityDescriptor(PSECURITY_DESCRIPTOR);

    impl SecurityDescriptor {
        fn from_sddl(sddl: &str) -> Result<Self, ()> {
            let text = wide(sddl);
            let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            let converted = unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    text.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    std::ptr::null_mut(),
                )
            };
            if converted == 0 || descriptor.is_null() {
                Err(())
            } else {
                Ok(Self(descriptor))
            }
        }
    }

    impl Drop for SecurityDescriptor {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_request, encode_response, MAX_MESSAGE_BYTES};
    use crate::protocol::{ServiceRequest, ServiceResponse};

    #[test]
    fn accepts_only_a_known_bounded_command() {
        let request = decode_request(br#"{"command":"GET_STATUS"}"#).expect("valid command");
        assert!(matches!(request, ServiceRequest::GetStatus));
        assert!(matches!(
            decode_request(br#"{"command":"EXECUTE_ARBITRARY_COMMAND"}"#),
            Err("IPC_REQUEST_INVALID")
        ));
        assert!(matches!(
            decode_request(&vec![b'x'; MAX_MESSAGE_BYTES + 1]),
            Err("IPC_MESSAGE_SIZE_INVALID")
        ));
    }

    #[test]
    fn serializes_a_redacted_error_code() {
        let payload = encode_response(&ServiceResponse::Error {
            code: "CONFIG_INVALID",
        })
        .expect("serialize response");
        let json = String::from_utf8(payload).expect("utf8 response");
        assert!(json.contains("CONFIG_INVALID"));
        assert!(!json.contains("privateKey"));
    }

    #[cfg(windows)]
    #[test]
    fn pipe_acl_rejects_remote_and_everyone_access() {
        assert!(super::platform::PIPE_SDDL.contains(";;;SY"));
        assert!(super::platform::PIPE_SDDL.contains(";;;BA"));
        assert!(super::platform::PIPE_SDDL.contains(";;;IU"));
        assert!(!super::platform::PIPE_SDDL.contains(";;;WD"));
        assert!(!super::platform::PIPE_SDDL.contains(";;;AN"));
    }
}
