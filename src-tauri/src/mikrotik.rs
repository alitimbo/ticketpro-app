use native_tls::{TlsConnector, TlsStream};
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
    queries: Option<HashMap<String, Value>>,
}

pub type ApiRow = HashMap<String, String>;

enum ApiStream {
    Tcp(TcpStream),
    Tls(TlsStream<TcpStream>),
}

impl Read for ApiStream {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Tcp(stream) => stream.read(buffer),
            Self::Tls(stream) => stream.read(buffer),
        }
    }
}

impl Write for ApiStream {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Tcp(stream) => stream.write(buffer),
            Self::Tls(stream) => stream.write(buffer),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Tcp(stream) => stream.flush(),
            Self::Tls(stream) => stream.flush(),
        }
    }
}

#[tauri::command]
pub fn mikrotik_api_call(request: MikroTikApiRequest) -> Result<Vec<ApiRow>, String> {
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
        .map_err(|error| format!("router offline: address unavailable: {error}"))?
        .next()
        .ok_or_else(|| "router offline: address unavailable".to_string())?;
    let stream = TcpStream::connect_timeout(&address, timeout).map_err(map_io_error)?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("timeout: read timeout unavailable: {error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("timeout: write timeout unavailable: {error}"))?;

    if request.use_ssl {
        let connector = TlsConnector::new().map_err(|error| format!("api ssl: TLS indisponible: {error}"))?;
        let mut stream = ApiStream::Tls(
            connector
                .connect(&request.host, stream)
                .map_err(|error| format!("api ssl: négociation TLS échouée: {error}"))?,
        );
        execute_session(&mut stream, request)
    } else {
        let mut stream = ApiStream::Tcp(stream);
        execute_session(&mut stream, request)
    }
}

fn execute_session<S: Read + Write>(stream: &mut S, request: &MikroTikApiRequest) -> Result<Vec<ApiRow>, String> {
    send_sentence(
        stream,
        &[
            "/login".to_string(),
            format!("=name={}", request.username),
            format!("=password={}", request.password),
        ],
    )?;
    read_response(stream)?;

    let mut words = vec![request.command.clone()];
    append_api_words(&mut words, "=", request.params.as_ref());
    append_api_words(&mut words, "?", request.queries.as_ref());

    send_sentence(stream, &words)?;
    read_response(stream)
}

fn append_api_words(
    words: &mut Vec<String>,
    prefix: &str,
    entries: Option<&HashMap<String, Value>>,
) {
    let Some(entries) = entries else {
        return;
    };

    for (key, value) in entries {
        if let Some(serialized) = serialize_api_value(value) {
            words.push(format!("{prefix}{key}={serialized}"));
        }
    }
}

fn serialize_api_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
        Value::Array(_) | Value::Object(_) => Some(value.to_string()),
    }
}

fn send_sentence<S: Read + Write>(stream: &mut S, words: &[String]) -> Result<(), String> {
    for word in words {
        write_word(stream, word.as_bytes())?;
    }

    write_word(stream, &[])?;
    stream.flush().map_err(map_io_error)
}

fn read_response<S: Read + Write>(stream: &mut S) -> Result<Vec<ApiRow>, String> {
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

fn read_sentence<S: Read + Write>(stream: &mut S) -> Result<Vec<String>, String> {
    let mut words = Vec::new();

    loop {
        let word = read_word(stream)?;

        if word.is_empty() {
            return Ok(words);
        }

        words.push(String::from_utf8_lossy(&word).to_string());
    }
}

fn write_word<S: Read + Write>(stream: &mut S, word: &[u8]) -> Result<(), String> {
    write_length(stream, word.len())?;
    stream.write_all(word).map_err(map_io_error)
}

fn read_word<S: Read + Write>(stream: &mut S) -> Result<Vec<u8>, String> {
    let length = read_length(stream)?;
    let mut buffer = vec![0_u8; length];

    if length > 0 {
        stream.read_exact(&mut buffer).map_err(map_io_error)?;
    }

    Ok(buffer)
}

fn write_length<S: Read + Write>(stream: &mut S, length: usize) -> Result<(), String> {
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

fn read_length<S: Read + Write>(stream: &mut S) -> Result<usize, String> {
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

fn read_byte<S: Read + Write>(stream: &mut S) -> Result<u8, String> {
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
        | ErrorKind::NotConnected => format!("router offline: {error}"),
        _ => format!("router offline: {error}"),
    }
}

fn is_non_retryable(error: &str) -> bool {
    let normalized = error.to_lowercase();
    normalized.contains("authentication failed")
        || normalized.contains("permission denied")
        || normalized.contains("duplicate user")
        || normalized.contains("hotspot not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn encodes_attributes_and_queries_with_distinct_routeros_prefixes() {
        let mut attributes = HashMap::new();
        attributes.insert("name".to_string(), json!("ticketpro-vpn"));
        attributes.insert("disabled".to_string(), json!(false));
        let mut queries = HashMap::new();
        queries.insert("comment".to_string(), json!("TicketPro WireGuard"));

        let mut words = vec!["/ip/firewall/filter/print".to_string()];
        append_api_words(&mut words, "=", Some(&attributes));
        append_api_words(&mut words, "?", Some(&queries));

        assert!(words.contains(&"=name=ticketpro-vpn".to_string()));
        assert!(words.contains(&"=disabled=false".to_string()));
        assert!(words.contains(&"?comment=TicketPro WireGuard".to_string()));
    }

    #[test]
    fn omits_null_values_but_preserves_empty_strings() {
        assert_eq!(serialize_api_value(&Value::Null), None);
        assert_eq!(serialize_api_value(&json!("")), Some(String::new()));
    }
}
