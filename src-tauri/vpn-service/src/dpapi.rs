use zeroize::Zeroizing;

const DESCRIPTION: &str = "TicketPro VPN device identity";

pub fn protect(secret: &[u8]) -> Result<Vec<u8>, &'static str> {
    protect_with_description(secret, DESCRIPTION)
}

pub fn unprotect(protected: &[u8]) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    unprotect_with_description(protected, DESCRIPTION)
}

pub fn protect_with_description(
    secret: &[u8],
    description: &str,
) -> Result<Vec<u8>, &'static str> {
    platform::protect(secret, description)
}

pub fn unprotect_with_description(
    protected: &[u8],
    description: &str,
) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    platform::unprotect(protected, description)
}

pub fn self_test() -> Result<(), &'static str> {
    let secret = Zeroizing::new(b"ticketpro-dpapi-self-test".to_vec());
    let protected = protect(&secret)?;
    let recovered = unprotect(&protected)?;
    if recovered.as_slice() != secret.as_slice() {
        return Err("DPAPI_ROUNDTRIP_FAILED");
    }
    Ok(())
}

#[cfg(windows)]
mod platform {
    use super::Zeroizing;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    pub fn protect(secret: &[u8], description: &str) -> Result<Vec<u8>, &'static str> {
        if secret.is_empty() || secret.len() > 4096 {
            return Err("IDENTITY_SECRET_SIZE_INVALID");
        }
        if description.is_empty() || description.len() > 128 {
            return Err("DPAPI_DESCRIPTION_INVALID");
        }
        let input = CRYPT_INTEGER_BLOB {
            cbData: secret.len() as u32,
            pbData: secret.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let description = std::ffi::OsStr::new(description)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let result = unsafe {
            CryptProtectData(
                &input,
                description.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result == 0 || output.pbData.is_null() {
            return Err("DPAPI_PROTECT_FAILED");
        }
        let protected =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            LocalFree(output.pbData as *mut _);
        }
        Ok(protected)
    }

    pub fn unprotect(
        protected: &[u8],
        expected_description: &str,
    ) -> Result<Zeroizing<Vec<u8>>, &'static str> {
        if protected.is_empty() || protected.len() > 16384 {
            return Err("IDENTITY_PROTECTED_SIZE_INVALID");
        }
        if expected_description.is_empty() || expected_description.len() > 128 {
            return Err("DPAPI_DESCRIPTION_INVALID");
        }
        let input = CRYPT_INTEGER_BLOB {
            cbData: protected.len() as u32,
            pbData: protected.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let mut actual_description = std::ptr::null_mut();
        let result = unsafe {
            CryptUnprotectData(
                &input,
                &mut actual_description,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result == 0 || output.pbData.is_null() {
            return Err("DPAPI_UNPROTECT_FAILED");
        }
        if actual_description.is_null() {
            unsafe { LocalFree(output.pbData as *mut _) };
            return Err("DPAPI_DESCRIPTION_MISSING");
        }
        let actual_description_text = unsafe {
            let mut length = 0usize;
            while *actual_description.add(length) != 0 {
                length += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(actual_description, length))
        };
        unsafe { LocalFree(actual_description as *mut _) };
        if actual_description_text != expected_description {
            unsafe { LocalFree(output.pbData as *mut _) };
            return Err("DPAPI_DESCRIPTION_MISMATCH");
        }
        let secret = Zeroizing::new(unsafe {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        });
        unsafe {
            LocalFree(output.pbData as *mut _);
        }
        Ok(secret)
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Zeroizing;

    pub fn protect(_secret: &[u8], _description: &str) -> Result<Vec<u8>, &'static str> {
        Err("WINDOWS_REQUIRED")
    }

    pub fn unprotect(
        _protected: &[u8],
        _description: &str,
    ) -> Result<Zeroizing<Vec<u8>>, &'static str> {
        Err("WINDOWS_REQUIRED")
    }
}
