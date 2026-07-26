use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DEVICE_FILE_NAME: &str = "license-device.bin";
const INSTALL_FILE_NAME: &str = "license-install.id";

fn fill_random(buffer: &mut [u8]) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Cryptography::BCryptGenRandom;
        let result = unsafe { BCryptGenRandom(std::ptr::null_mut(), buffer.as_mut_ptr(), buffer.len() as u32, 0x00000002) };
        if result != 0 { return Err(format!("BCryptGenRandom a échoué: {result}")); }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = format!("{}:{}:{}", SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos(), std::process::id(), buffer.len());
        let digest = sha256(seed.as_bytes());
        for (index, byte) in buffer.iter_mut().enumerate() { *byte = digest[index % digest.len()]; }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
pub struct LicenseDeviceIdentity {
    pub device_id: String,
    pub install_id: String,
}

fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn read_or_create_install_id(app: &AppHandle) -> Result<String, String> {
    let path = data_directory(app)?.join(INSTALL_FILE_NAME);
    if let Ok(value) = fs::read_to_string(&path) {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return Ok(value);
        }
    }

    let mut bytes = [0_u8; 16];
    fill_random(&mut bytes)?;
    let value = bytes_to_hex(&bytes);
    fs::write(path, &value).map_err(|error| error.to_string())?;
    Ok(value)
}

#[cfg(windows)]
fn protect_secret(secret: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};

    let input = CRYPT_INTEGER_BLOB { cbData: secret.len() as u32, pbData: secret.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
    let result = unsafe { CryptProtectData(&input, ptr::null(), ptr::null(), ptr::null(), ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output) };
    if result == 0 {
        return Err("Windows DPAPI n'a pas pu protéger l'identité de l'appareil.".to_string());
    }
    let protected = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut _); }
    Ok(protected)
}

#[cfg(not(windows))]
fn protect_secret(secret: &[u8]) -> Result<Vec<u8>, String> {
    Ok(secret.to_vec())
}

#[cfg(windows)]
fn unprotect_secret(protected: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};

    let input = CRYPT_INTEGER_BLOB { cbData: protected.len() as u32, pbData: protected.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
    let result = unsafe { CryptUnprotectData(&input, ptr::null_mut(), ptr::null(), ptr::null(), ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output) };
    if result == 0 {
        return Err("Windows DPAPI n'a pas pu lire l'identité de l'appareil.".to_string());
    }
    let secret = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut _); }
    Ok(secret)
}

#[cfg(not(windows))]
fn unprotect_secret(protected: &[u8]) -> Result<Vec<u8>, String> {
    Ok(protected.to_vec())
}

fn read_or_create_secret(app: &AppHandle) -> Result<Vec<u8>, String> {
    let path = data_directory(app)?.join(DEVICE_FILE_NAME);
    if let Ok(protected) = fs::read(&path) {
        return unprotect_secret(&protected);
    }

    let mut secret = [0_u8; 32];
    fill_random(&mut secret)?;
    fs::write(path, protect_secret(&secret)?).map_err(|error| error.to_string())?;
    Ok(secret.to_vec())
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    let mut data = input.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 { data.push(0); }
    data.extend_from_slice(&((input.len() as u64) * 8).to_be_bytes());
    let mut state: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    for chunk in data.chunks_exact(64) {
        let mut words = [0_u32; 64];
        for (index, word) in words[..16].iter_mut().enumerate() {
            *word = u32::from_be_bytes([chunk[index * 4], chunk[index * 4 + 1], chunk[index * 4 + 2], chunk[index * 4 + 3]]);
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7) ^ words[index - 15].rotate_right(18) ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17) ^ words[index - 2].rotate_right(19) ^ (words[index - 2] >> 10);
            words[index] = words[index - 16].wrapping_add(s0).wrapping_add(words[index - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h) = (state[0], state[1], state[2], state[3], state[4], state[5], state[6], state[7]);
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[index]).wrapping_add(words[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            (h, g, f, e, d, c, b, a) = (g, f, e, d.wrapping_add(temp1), c, b, a, temp1.wrapping_add(temp2));
        }
        state[0] = state[0].wrapping_add(a); state[1] = state[1].wrapping_add(b); state[2] = state[2].wrapping_add(c); state[3] = state[3].wrapping_add(d);
        state[4] = state[4].wrapping_add(e); state[5] = state[5].wrapping_add(f); state[6] = state[6].wrapping_add(g); state[7] = state[7].wrapping_add(h);
    }
    let mut output = [0_u8; 32];
    for (index, word) in state.iter().enumerate() { output[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes()); }
    output
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut key_block = [0_u8; 64];
    if key.len() > 64 { key_block[..32].copy_from_slice(&sha256(key)); } else { key_block[..key.len()].copy_from_slice(key); }
    let mut inner = Vec::with_capacity(64 + message.len());
    let mut outer = Vec::with_capacity(64 + 32);
    for byte in key_block { inner.push(byte ^ 0x36); outer.push(byte ^ 0x5c); }
    inner.extend_from_slice(message);
    outer.extend_from_slice(&sha256(&inner));
    sha256(&outer)
}

#[tauri::command]
pub fn license_get_device_identity(app: AppHandle) -> Result<LicenseDeviceIdentity, String> {
    let secret = read_or_create_secret(&app)?;
    let install_id = read_or_create_install_id(&app)?;
    let device_id = bytes_to_hex(&sha256(&secret));
    Ok(LicenseDeviceIdentity { device_id, install_id })
}

#[tauri::command]
pub fn license_sign_device_payload(app: AppHandle, payload: String) -> Result<String, String> {
    let secret = read_or_create_secret(&app)?;
    Ok(bytes_to_hex(&hmac_sha256(&secret, payload.as_bytes())))
}

#[tauri::command]
pub fn license_protect_value(_app: AppHandle, value: String) -> Result<String, String> {
    Ok(bytes_to_hex(&protect_secret(value.as_bytes())?))
}

#[tauri::command]
pub fn license_unprotect_value(_app: AppHandle, value: String) -> Result<String, String> {
    let bytes = (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    String::from_utf8(unprotect_secret(&bytes)?).map_err(|error| error.to_string())
}
