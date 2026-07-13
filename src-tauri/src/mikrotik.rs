use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MikroTikApiRequest {
    host: String,
    port: u16,
    username: String,
    password: String,
    use_ssl: bool,
    timeout_ms: Option<u64>,
    retries: Option<u8>,
    command: String,
    params: Option<HashMap<String, Value>>,
}

pub type ApiRow = HashMap<String, String>;

#[tauri::command]
pub fn mikrotik_api_call(request: MikroTikApiRequest) -> Result<Vec<ApiRow>, String> {
    if request.use_ssl {
        return Err("api disabled: API-SSL transport is not enabled in this build".to_string());
    }

    let retries = request.retries.unwrap_or(1);
    let mut last_error = "router offline".to_string();

    for attempt in 0..=retries {
        match execute_once(&request) {
            Ok(rows) => return Ok(rows),
            Err(error) => {
                last_error = error;

                if is_non_retryable(&last_error) || attempt == retries {
                    break;
                }
            }
        }
    }

    Err(last_error)
}

fn execute_once(request: &MikroTikApiRequest) -> Result<Vec<ApiRow>, String> {
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(5000));
    let address = (request.host.as_str(), request.port)
        .to_socket_addrs()
        .map_err(|_| "router offline: address unavailable".to_string())?
        .next()
        .ok_or_else(|| "router offline: address unavailable".to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, timeout).map_err(map_io_error)?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| "timeout: read timeout unavailable".to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|_| "timeout: write timeout unavailable".to_string())?;

    send_sentence(
        &mut stream,
        &[
            "/login".to_string(),
            format!("=name={}", request.username),
            format!("=password={}", request.password),
        ],
    )?;
    read_response(&mut stream)?;

    let mut words = vec![request.command.clone()];

    if let Some(params) = &request.params {
        for (key, value) in params {
            if value.is_null() {
                continue;
            }

            match value {
                Value::Bool(true) => words.push(format!("={}=", key)),
                Value::Bool(false) => {}
                Value::Number(number) => words.push(format!("={}={}", key, number)),
                Value::String(text) if !text.is_empty() => words.push(format!("={}={}", key, text)),
                Value::String(_) => {}
                _ => words.push(format!("={}={}", key, value)),
            }
        }
    }

    send_sentence(&mut stream, &words)?;
    read_response(&mut stream)
}

fn send_sentence(stream: &mut TcpStream, words: &[String]) -> Result<(), String> {
    for word in words {
        write_word(stream, word.as_bytes())?;
    }

    write_word(stream, &[])?;
    stream.flush().map_err(map_io_error)
}

fn read_response(stream: &mut TcpStream) -> Result<Vec<ApiRow>, String> {
    let mut rows = Vec::new();

    loop {
        let words = read_sentence(stream)?;

        if words.is_empty() {
            continue;
        }

        match words[0].as_str() {
            "!done" => return Ok(rows),
            "!re" => rows.push(words_to_row(&words[1..])),
            "!trap" => return Err(map_trap(words_to_row(&words[1..]))),
            "!fatal" => return Err("router offline: fatal API response".to_string()),
            _ => {}
        }
    }
}

fn read_sentence(stream: &mut TcpStream) -> Result<Vec<String>, String> {
    let mut words = Vec::new();

    loop {
        let word = read_word(stream)?;

        if word.is_empty() {
            return Ok(words);
        }

        words.push(String::from_utf8_lossy(&word).to_string());
    }
}

fn write_word(stream: &mut TcpStream, word: &[u8]) -> Result<(), String> {
    write_length(stream, word.len())?;
    stream.write_all(word).map_err(map_io_error)
}

fn read_word(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let length = read_length(stream)?;
    let mut buffer = vec![0_u8; length];

    if length > 0 {
        stream.read_exact(&mut buffer).map_err(map_io_error)?;
    }

    Ok(buffer)
}

fn write_length(stream: &mut TcpStream, length: usize) -> Result<(), String> {
    let bytes = if length < 0x80 {
        vec![length as u8]
    } else if length < 0x4000 {
        vec![((length >> 8) as u8) | 0x80, (length & 0xFF) as u8]
    } else if length < 0x20_0000 {
        vec![
            ((length >> 16) as u8) | 0xC0,
            ((length >> 8) & 0xFF) as u8,
            (length & 0xFF) as u8,
        ]
    } else if length < 0x1000_0000 {
        vec![
            ((length >> 24) as u8) | 0xE0,
            ((length >> 16) & 0xFF) as u8,
            ((length >> 8) & 0xFF) as u8,
            (length & 0xFF) as u8,
        ]
    } else {
        vec![
            0xF0,
            ((length >> 24) & 0xFF) as u8,
            ((length >> 16) & 0xFF) as u8,
            ((length >> 8) & 0xFF) as u8,
            (length & 0xFF) as u8,
        ]
    };

    stream.write_all(&bytes).map_err(map_io_error)
}

fn read_length(stream: &mut TcpStream) -> Result<usize, String> {
    let first = read_byte(stream)?;

    if first & 0x80 == 0 {
        return Ok(first as usize);
    }

    if first & 0xC0 == 0x80 {
        let second = read_byte(stream)?;
        return Ok((((first & 0x3F) as usize) << 8) + second as usize);
    }

    if first & 0xE0 == 0xC0 {
        let second = read_byte(stream)?;
        let third = read_byte(stream)?;
        return Ok((((first & 0x1F) as usize) << 16) + ((second as usize) << 8) + third as usize);
    }

    if first & 0xF0 == 0xE0 {
        let second = read_byte(stream)?;
        let third = read_byte(stream)?;
        let fourth = read_byte(stream)?;
        return Ok((((first & 0x0F) as usize) << 24)
            + ((second as usize) << 16)
            + ((third as usize) << 8)
            + fourth as usize);
    }

    let second = read_byte(stream)?;
    let third = read_byte(stream)?;
    let fourth = read_byte(stream)?;
    let fifth = read_byte(stream)?;

    Ok(((second as usize) << 24)
        + ((third as usize) << 16)
        + ((fourth as usize) << 8)
        + fifth as usize)
}

fn read_byte(stream: &mut TcpStream) -> Result<u8, String> {
    let mut buffer = [0_u8; 1];
    stream.read_exact(&mut buffer).map_err(map_io_error)?;
    Ok(buffer[0])
}

fn words_to_row(words: &[String]) -> ApiRow {
    let mut row = ApiRow::new();

    for word in words {
        if !word.starts_with('=') {
            continue;
        }

        let trimmed = &word[1..];
        if let Some((key, value)) = trimmed.split_once('=') {
            row.insert(key.to_string(), value.to_string());
        }
    }

    row
}

fn map_trap(row: ApiRow) -> String {
    let message = row
        .get("message")
        .cloned()
        .unwrap_or_else(|| "RouterOS API trap".to_string());
    let normalized = message.to_lowercase();

    if normalized.contains("cannot log in") || normalized.contains("invalid user") {
        return "authentication failed".to_string();
    }

    if normalized.contains("not enough permissions") || normalized.contains("permission") {
        return "permission denied".to_string();
    }

    if normalized.contains("already") || normalized.contains("failure: user") {
        return "duplicate user".to_string();
    }

    if normalized.contains("no such item") || normalized.contains("not found") {
        return "hotspot not found".to_string();
    }

    message
}

fn map_io_error(error: std::io::Error) -> String {
    use std::io::ErrorKind;

    match error.kind() {
        ErrorKind::ConnectionRefused => "connection refused".to_string(),
        ErrorKind::TimedOut | ErrorKind::WouldBlock => "timeout".to_string(),
        ErrorKind::NotFound
        | ErrorKind::AddrNotAvailable
        | ErrorKind::ConnectionAborted
        | ErrorKind::ConnectionReset
        | ErrorKind::NotConnected => "router offline".to_string(),
        _ => "router offline".to_string(),
    }
}

fn is_non_retryable(error: &str) -> bool {
    let normalized = error.to_lowercase();
    normalized.contains("authentication failed")
        || normalized.contains("permission denied")
        || normalized.contains("duplicate user")
        || normalized.contains("hotspot not found")
}
