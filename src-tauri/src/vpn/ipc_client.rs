use serde_json::{json, Value};

const PIPE_NAME: &str = r"\\.\pipe\TicketProVpnService.v1";
const MAX_MESSAGE_BYTES: usize = 64 * 1024;

pub fn request(command: &'static str) -> Result<Value, &'static str> {
    request_with_payload(command, None)
}

pub fn request_with_payload(
    command: &'static str,
    request_payload: Option<Value>,
) -> Result<Value, &'static str> {
    if !matches!(
        command,
        "GET_STATUS"
            | "GET_VERSION"
            | "ENSURE_IDENTITY"
            | "GET_PUBLIC_IDENTITY"
            | "APPLY_CONFIG"
            | "START"
            | "STOP"
            | "REPAIR"
            | "PREPARE_IDENTITY_ROTATION"
            | "COMMIT_IDENTITY_ROTATION"
            | "ABORT_IDENTITY_ROTATION"
    ) {
        return Err("VPN_SERVICE_COMMAND_NOT_ALLOWED");
    }
    let request = match request_payload {
        Some(payload) => json!({ "command": command, "payload": payload }),
        None => json!({ "command": command }),
    };
    let payload = serde_json::to_vec(&request)
        .map_err(|_| "VPN_SERVICE_REQUEST_INVALID")?;
    platform::exchange(&payload).and_then(parse_response)
}

fn parse_response(payload: Vec<u8>) -> Result<Value, &'static str> {
    if payload.is_empty() || payload.len() > MAX_MESSAGE_BYTES {
        return Err("VPN_SERVICE_RESPONSE_SIZE_INVALID");
    }
    serde_json::from_slice(&payload).map_err(|_| "VPN_SERVICE_RESPONSE_INVALID")
}

#[cfg(windows)]
mod platform {
    use super::{MAX_MESSAGE_BYTES, PIPE_NAME};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Pipes::WaitNamedPipeW;

    pub fn exchange(request: &[u8]) -> Result<Vec<u8>, &'static str> {
        if request.is_empty() || request.len() > MAX_MESSAGE_BYTES {
            return Err("VPN_SERVICE_REQUEST_SIZE_INVALID");
        }
        let pipe_name = wide(PIPE_NAME);
        if unsafe { WaitNamedPipeW(pipe_name.as_ptr(), 1_500) } == 0 {
            return Err("VPN_SERVICE_UNAVAILABLE");
        }
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
            return Err("VPN_SERVICE_UNAVAILABLE");
        }
        let handle = HandleGuard(handle);
        write_all(handle.0, &(request.len() as u32).to_le_bytes())?;
        write_all(handle.0, request)?;
        let mut header = [0u8; 4];
        read_exact(handle.0, &mut header)?;
        let length = u32::from_le_bytes(header) as usize;
        if length == 0 || length > MAX_MESSAGE_BYTES {
            return Err("VPN_SERVICE_RESPONSE_SIZE_INVALID");
        }
        let mut response = vec![0u8; length];
        read_exact(handle.0, &mut response)?;
        Ok(response)
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
                return Err("VPN_SERVICE_READ_FAILED");
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
                return Err("VPN_SERVICE_WRITE_FAILED");
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
}

#[cfg(not(windows))]
mod platform {
    pub fn exchange(_request: &[u8]) -> Result<Vec<u8>, &'static str> {
        Err("WINDOWS_REQUIRED")
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_response, request, MAX_MESSAGE_BYTES};

    #[test]
    fn rejects_commands_outside_the_closed_protocol() {
        assert!(matches!(
            request("EXECUTE_ARBITRARY_COMMAND"),
            Err("VPN_SERVICE_COMMAND_NOT_ALLOWED")
        ));
    }

    #[test]
    fn rejects_oversized_or_invalid_responses() {
        assert!(parse_response(vec![b'x'; MAX_MESSAGE_BYTES + 1]).is_err());
        assert!(parse_response(b"not-json".to_vec()).is_err());
    }
}
