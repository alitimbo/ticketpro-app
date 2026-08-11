use std::path::Path;

// DACL protegee : LocalSystem et administrateurs locaux seulement. OI/CI
// assurent l'heritage sur les futurs fichiers et sous-repertoires.
#[cfg(any(not(debug_assertions), test))]
const TICKETPRO_VPN_SDDL: &str = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";

pub fn protect_path(path: &Path) -> Result<(), &'static str> {
    #[cfg(debug_assertions)]
    {
        // Les auto-tests utilisent un repertoire aleatoire dans %TEMP% sous
        // l'identite du developpeur. Les ACL SYSTEM sont validees en release
        // et dans la VM POC elevee, jamais sur les donnees de developpement.
        let _ = path;
        return Ok(());
    }

    #[cfg(not(debug_assertions))]
    platform::protect_path(path)
}

#[cfg(all(windows, not(debug_assertions)))]
mod platform {
    use super::{Path, TICKETPRO_VPN_SDDL};
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR,
    };

    pub fn protect_path(path: &Path) -> Result<(), &'static str> {
        if !path.is_absolute() || !path.exists() {
            return Err("SECURE_PATH_INVALID");
        }
        let descriptor_text = std::ffi::OsStr::new(TICKETPRO_VPN_SDDL)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let converted = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor_text.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        };
        if converted == 0 || descriptor.is_null() {
            return Err("SECURITY_DESCRIPTOR_INVALID");
        }
        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let applied = unsafe {
            SetFileSecurityW(
                wide_path.as_ptr(),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor,
            )
        };
        unsafe {
            LocalFree(descriptor);
        }
        if applied == 0 {
            return Err("SECURE_PATH_ACL_FAILED");
        }
        Ok(())
    }
}

#[cfg(all(not(windows), not(debug_assertions)))]
mod platform {
    use super::Path;

    pub fn protect_path(_path: &Path) -> Result<(), &'static str> {
        Err("WINDOWS_REQUIRED")
    }
}

#[cfg(test)]
mod tests {
    use super::TICKETPRO_VPN_SDDL;

    #[test]
    fn acl_allows_only_system_and_administrators() {
        assert!(TICKETPRO_VPN_SDDL.contains(";;;SY"));
        assert!(TICKETPRO_VPN_SDDL.contains(";;;BA"));
        assert!(!TICKETPRO_VPN_SDDL.contains(";;;WD"));
        assert!(!TICKETPRO_VPN_SDDL.contains(";;;BU"));
    }
}
