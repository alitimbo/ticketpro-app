use serde::Serialize;
use tauri::AppHandle;

use crate::files::managed_file_path;

#[derive(Debug, Serialize)]
pub struct SystemPrinter {
    pub id: String,
    pub is_default: bool,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct PrintSubmission {
    pub printer_name: String,
    pub submitted: bool,
}

#[tauri::command]
pub fn print_list_printers() -> Result<Vec<SystemPrinter>, String> {
    platform::list_printers()
}

#[tauri::command]
pub fn print_file(
    app: AppHandle,
    relative_path: String,
    printer_name: String,
) -> Result<PrintSubmission, String> {
    let path = managed_file_path(&app, &relative_path)?;

    if !path.is_file() {
        return Err("Fichier à imprimer introuvable.".to_string());
    }

    platform::print_file(&path, &printer_name)
}

#[cfg(windows)]
mod platform {
    use super::{PrintSubmission, SystemPrinter};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, GetDefaultPrinterW, PRINTER_INFO_4W, PRINTER_ENUM_CONNECTIONS,
        PRINTER_ENUM_LOCAL,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    pub fn list_printers() -> Result<Vec<SystemPrinter>, String> {
        let default_name = default_printer_name();
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut required_bytes = 0u32;
        let mut returned = 0u32;

        unsafe {
            EnumPrintersW(
                flags,
                null_mut(),
                4,
                null_mut(),
                0,
                &mut required_bytes,
                &mut returned,
            );
        }

        if required_bytes == 0 {
            return Ok(Vec::new());
        }

        let mut buffer = vec![0u8; required_bytes as usize];
        let success = unsafe {
            EnumPrintersW(
                flags,
                null_mut(),
                4,
                buffer.as_mut_ptr(),
                required_bytes,
                &mut required_bytes,
                &mut returned,
            )
        };

        if success == 0 {
            return Err("Windows n'a pas pu lister les imprimantes.".to_string());
        }

        let entries = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr() as *const PRINTER_INFO_4W, returned as usize)
        };

        Ok(entries
            .iter()
            .filter_map(|entry| unsafe { wide_string(entry.pPrinterName) })
            .map(|name| {
                let is_default = default_name.as_deref() == Some(name.as_str());
                SystemPrinter {
                    id: format!("windows:{name}"),
                    is_default,
                    name,
                    status: "available".to_string(),
                }
            })
            .collect())
    }

    pub fn print_file(path: &Path, printer_name: &str) -> Result<PrintSubmission, String> {
        if printer_name.trim().is_empty() {
            return Err("Aucune imprimante n'est sélectionnée.".to_string());
        }

        let operation = wide("printto");
        let file = wide(path.to_string_lossy().as_ref());
        let printer = wide(printer_name);
        let result = unsafe {
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                printer.as_ptr(),
                null(),
                SW_HIDE,
            )
        };

        if (result as isize) <= 32 {
            return Err("Windows n'a pas pu envoyer le fichier à l'imprimante.".to_string());
        }

        Ok(PrintSubmission {
            printer_name: printer_name.to_string(),
            submitted: true,
        })
    }

    fn default_printer_name() -> Option<String> {
        let mut buffer = vec![0u16; 512];
        let mut size = buffer.len() as u32;

        let success = unsafe { GetDefaultPrinterW(buffer.as_mut_ptr(), &mut size) };

        if success == 0 || size == 0 {
            return None;
        }

        buffer.truncate(size.saturating_sub(1) as usize);
        String::from_utf16(&buffer).ok()
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
    }

    unsafe fn wide_string(pointer: windows_sys::core::PWSTR) -> Option<String> {
        if pointer.is_null() {
            return None;
        }

        let mut length = 0usize;
        while *pointer.add(length) != 0 {
            length += 1;
        }

        String::from_utf16(std::slice::from_raw_parts(pointer, length)).ok()
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{PrintSubmission, SystemPrinter};
    use std::path::Path;

    pub fn list_printers() -> Result<Vec<SystemPrinter>, String> {
        Ok(Vec::new())
    }

    pub fn print_file(_path: &Path, _printer_name: &str) -> Result<PrintSubmission, String> {
        Err("L'impression native est disponible uniquement sous Windows.".to_string())
    }
}
