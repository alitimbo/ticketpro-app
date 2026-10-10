use native_tls::{TlsConnector, TlsStream};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MikroTikApiBatchRequest {
    host: String,
    port: u16,
    username: String,
    password: String,
    use_ssl: bool,
    timeout_ms: Option<u64>,
    retries: Option<u8>,
    commands: Vec<MikroTikApiBatchCommand>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MikroTikApiBatchCommand {
    command: String,
    params: Option<HashMap<String, Value>>,
    queries: Option<HashMap<String, Value>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MikroTikApiBatchItemResult {
    rows: Vec<ApiRow>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterOsCommandPerformance {
    command: String,
    duration_ms: f64,
    outcome: &'static str,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterOsNativePerformance {
    auth_duration_ms: f64,
    command_count: usize,
    command_timings: Vec<RouterOsCommandPerformance>,
    connect_duration_ms: f64,
    connection_count: usize,
    fatal_count: usize,
    retry_count: usize,
    reused_connection_count: usize,
    trap_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MikroTikApiCallResponse {
    error: Option<String>,
    metrics: RouterOsNativePerformance,
    rows: Vec<ApiRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MikroTikApiBatchResponse {
    completed_count: usize,
    connection_error: Option<String>,
    error: Option<String>,
    metrics: RouterOsNativePerformance,
    results: Vec<MikroTikApiBatchItemResult>,
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
pub async fn mikrotik_api_call(
    request: MikroTikApiRequest,
) -> Result<MikroTikApiCallResponse, String> {
    tauri::async_runtime::spawn_blocking(move || mikrotik_api_call_blocking(request))
        .await
        .map_err(|error| format!("router offline: tâche RouterOS interrompue: {error}"))?
}

#[tauri::command]
pub async fn mikrotik_api_batch(
    request: MikroTikApiBatchRequest,
) -> Result<MikroTikApiBatchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || mikrotik_api_batch_blocking(request))
        .await
        .map_err(|error| format!("router offline: batch RouterOS interrompu: {error}"))?
}

fn mikrotik_api_batch_blocking(
    request: MikroTikApiBatchRequest,
) -> Result<MikroTikApiBatchResponse, String> {
    if request.commands.is_empty() || request.commands.len() > 1_000 {
        return Err("router rejected: batch size must be between 1 and 1000".to_string());
    }

    let retries = request.retries.unwrap_or(1);
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(5000));
    let key = PoolKey::new(
        &request.host,
        request.port,
        &request.username,
        &request.password,
        request.use_ssl,
    );
    let mut metrics = RouterOsNativePerformance::default();
    let mut allow_pooled = true;

    loop {
        let (mut stream, reused) = match acquire_stream(
            &key,
            &request.host,
            request.port,
            &request.username,
            &request.password,
            request.use_ssl,
            timeout,
            retries,
            allow_pooled,
            &mut metrics,
        ) {
            Ok(acquired) => acquired,
            Err(last_error) => {
                return Ok(MikroTikApiBatchResponse {
                    completed_count: 0,
                    connection_error: None,
                    error: Some(last_error),
                    metrics,
                    results: Vec::new(),
                });
            }
        };
        let mut results = Vec::with_capacity(request.commands.len());
        let mut connection_error = None;

        for command in &request.commands {
            let mut words = vec![command.command.clone()];
            append_api_words(&mut words, "=", command.params.as_ref());
            append_api_words(&mut words, "?", command.queries.as_ref());
            let command_started_at = Instant::now();
            metrics.command_count += 1;

            if let Err(error) = send_sentence(&mut stream, &words) {
                metrics.command_timings.push(RouterOsCommandPerformance {
                    command: command.command.clone(),
                    duration_ms: elapsed_ms(command_started_at),
                    outcome: "connection",
                });
                connection_error = Some(error);
                break;
            }
            match read_response_outcome(&mut stream) {
                Ok(outcome) => {
                    metrics.trap_count += outcome.trap_count;
                    metrics.command_timings.push(RouterOsCommandPerformance {
                        command: command.command.clone(),
                        duration_ms: elapsed_ms(command_started_at),
                        outcome: if outcome.error.is_some() {
                            "trap"
                        } else {
                            "success"
                        },
                    });
                    results.push(MikroTikApiBatchItemResult {
                        error: outcome.error,
                        rows: outcome.rows,
                    });
                }
                Err(error) => {
                    let outcome = if is_fatal_response(&error) {
                        metrics.fatal_count += 1;
                        "fatal"
                    } else {
                        "connection"
                    };
                    metrics.command_timings.push(RouterOsCommandPerformance {
                        command: command.command.clone(),
                        duration_ms: elapsed_ms(command_started_at),
                        outcome,
                    });
                    connection_error = Some(error);
                    break;
                }
            }
        }

        // A reused connection that the router had already closed fails on the
        // very first command, before RouterOS executed anything: start again
        // once on a fresh connection. Reconnecting after a command succeeded
        // stays forbidden: the caller reconciles by username instead of
        // replaying an uncertain command and risking a duplicate voucher.
        if reused && results.is_empty() {
            if let Some(error) = &connection_error {
                if is_stale_connection_error(error) {
                    allow_pooled = false;
                    metrics.retry_count += 1;
                    continue;
                }
            }
        }

        if connection_error.is_none() {
            release_stream(key, stream);
        }
        return Ok(MikroTikApiBatchResponse {
            completed_count: results.len(),
            connection_error,
            error: None,
            metrics,
            results,
        });
    }
}

fn mikrotik_api_call_blocking(
    request: MikroTikApiRequest,
) -> Result<MikroTikApiCallResponse, String> {
    let retries = request.retries.unwrap_or(1);
    let mut last_error = "router offline".to_string();
    let mut metrics = RouterOsNativePerformance::default();
    let mut allow_pooled = true;
    let mut attempt = 0;

    while attempt <= retries {
        match execute_once(&request, &mut metrics, allow_pooled) {
            Ok(rows) => {
                return Ok(MikroTikApiCallResponse {
                    error: None,
                    metrics,
                    rows,
                })
            }
            Err(failure) => {
                last_error = failure.error;
                // A stale pooled connection costs one fresh attempt, not a retry.
                if failure.reused && is_stale_connection_error(&last_error) {
                    allow_pooled = false;
                    metrics.retry_count += 1;
                    continue;
                }
                if is_non_retryable(&last_error) || attempt == retries {
                    break;
                }
                allow_pooled = false;
                attempt += 1;
                metrics.retry_count += 1;
            }
        }
    }

    Ok(MikroTikApiCallResponse {
        error: Some(last_error),
        metrics,
        rows: Vec::new(),
    })
}

fn open_authenticated_stream(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    use_ssl: bool,
    timeout: Duration,
    metrics: &mut RouterOsNativePerformance,
) -> Result<ApiStream, String> {
    metrics.connection_count += 1;
    let connect_started_at = Instant::now();
    let connection = (|| -> Result<ApiStream, String> {
        let address = (host, port)
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

        if use_ssl {
            let connector = TlsConnector::new()
                .map_err(|error| format!("api ssl: TLS unavailable: {error}"))?;
            Ok(ApiStream::Tls(connector.connect(host, stream).map_err(
                |error| format!("api ssl: TLS negotiation failed: {error}"),
            )?))
        } else {
            Ok(ApiStream::Tcp(stream))
        }
    })();
    metrics.connect_duration_ms += elapsed_ms(connect_started_at);
    let mut stream = connection?;

    let auth_started_at = Instant::now();
    let authentication = (|| -> Result<(), String> {
        send_sentence(
            &mut stream,
            &[
                "/login".to_string(),
                format!("=name={username}"),
                format!("=password={password}"),
            ],
        )?;
        let outcome = read_response_outcome(&mut stream)?;
        metrics.trap_count += outcome.trap_count;
        match outcome.error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    })();
    metrics.auth_duration_ms += elapsed_ms(auth_started_at);
    if let Err(error) = authentication {
        if is_fatal_response(&error) {
            metrics.fatal_count += 1;
        }
        return Err(error);
    }
    Ok(stream)
}

struct ExecuteFailure {
    error: String,
    reused: bool,
}

fn execute_once(
    request: &MikroTikApiRequest,
    metrics: &mut RouterOsNativePerformance,
    allow_pooled: bool,
) -> Result<Vec<ApiRow>, ExecuteFailure> {
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(5000));
    let key = PoolKey::new(
        &request.host,
        request.port,
        &request.username,
        &request.password,
        request.use_ssl,
    );
    let (mut stream, reused) = acquire_stream(
        &key,
        &request.host,
        request.port,
        &request.username,
        &request.password,
        request.use_ssl,
        timeout,
        0,
        allow_pooled,
        metrics,
    )
    .map_err(|error| ExecuteFailure {
        error,
        reused: false,
    })?;
    let fail = |error: String| ExecuteFailure { error, reused };
    let mut words = vec![request.command.clone()];
    append_api_words(&mut words, "=", request.params.as_ref());
    append_api_words(&mut words, "?", request.queries.as_ref());
    let command_started_at = Instant::now();
    metrics.command_count += 1;
    if let Err(error) = send_sentence(&mut stream, &words) {
        metrics.command_timings.push(RouterOsCommandPerformance {
            command: request.command.clone(),
            duration_ms: elapsed_ms(command_started_at),
            outcome: "connection",
        });
        return Err(fail(error));
    }
    match read_response_outcome(&mut stream) {
        Ok(outcome) => {
            metrics.trap_count += outcome.trap_count;
            metrics.command_timings.push(RouterOsCommandPerformance {
                command: request.command.clone(),
                duration_ms: elapsed_ms(command_started_at),
                outcome: if outcome.error.is_some() {
                    "trap"
                } else {
                    "success"
                },
            });
            // The whole response, trap included, was read up to !done: the
            // connection is clean and can serve the next command.
            release_stream(key, stream);
            match outcome.error {
                Some(error) => Err(fail(error)),
                None => Ok(outcome.rows),
            }
        }
        Err(error) => {
            let outcome = if is_fatal_response(&error) {
                metrics.fatal_count += 1;
                "fatal"
            } else {
                "connection"
            };
            metrics.command_timings.push(RouterOsCommandPerformance {
                command: request.command.clone(),
                duration_ms: elapsed_ms(command_started_at),
                outcome,
            });
            Err(fail(error))
        }
    }
}

/// Idle authenticated connections, reused for the same router and account.
/// RouterOS keeps an API session open while idle; a short lifetime limits the
/// risk of reusing a connection silently dropped by a NAT or a VPN.
const POOL_IDLE_TTL: Duration = Duration::from_secs(15);
const POOL_MAX_IDLE_PER_ENDPOINT: usize = 4;

#[derive(Clone, PartialEq, Eq, Hash)]
struct PoolKey {
    host: String,
    port: u16,
    username: String,
    /// Changing the password never reuses a session opened with the old one.
    password_digest: u64,
    use_ssl: bool,
}

impl PoolKey {
    fn new(host: &str, port: u16, username: &str, password: &str, use_ssl: bool) -> Self {
        let mut hasher = DefaultHasher::new();
        password.hash(&mut hasher);
        Self {
            host: host.trim().to_lowercase(),
            port,
            username: username.to_string(),
            password_digest: hasher.finish(),
            use_ssl,
        }
    }
}

struct IdleConnection {
    idle_since: Instant,
    stream: ApiStream,
}

fn connection_pool() -> &'static Mutex<HashMap<PoolKey, Vec<IdleConnection>>> {
    static POOL: OnceLock<Mutex<HashMap<PoolKey, Vec<IdleConnection>>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

impl ApiStream {
    fn tcp(&self) -> &TcpStream {
        match self {
            Self::Tcp(stream) => stream,
            Self::Tls(stream) => stream.get_ref(),
        }
    }
}

/// Peer closed or unexpected unread bytes: not reusable.
fn is_reusable(stream: &ApiStream, timeout: Duration) -> bool {
    let tcp = stream.tcp();
    if tcp.set_nonblocking(true).is_err() {
        return false;
    }
    let mut probe = [0u8; 1];
    let alive = matches!(
        tcp.peek(&mut probe),
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock
    );
    tcp.set_nonblocking(false).is_ok()
        && tcp.set_read_timeout(Some(timeout)).is_ok()
        && tcp.set_write_timeout(Some(timeout)).is_ok()
        && alive
}

fn take_idle_stream(key: &PoolKey, timeout: Duration) -> Option<ApiStream> {
    let mut pool = connection_pool().lock().ok()?;
    let idle = pool.get_mut(key)?;
    while let Some(candidate) = idle.pop() {
        if candidate.idle_since.elapsed() <= POOL_IDLE_TTL && is_reusable(&candidate.stream, timeout) {
            return Some(candidate.stream);
        }
    }
    None
}

fn release_stream(key: PoolKey, stream: ApiStream) {
    let Ok(mut pool) = connection_pool().lock() else {
        return;
    };
    pool.retain(|_, idle| {
        idle.retain(|connection| connection.idle_since.elapsed() <= POOL_IDLE_TTL);
        !idle.is_empty()
    });
    let idle = pool.entry(key).or_default();
    if idle.len() < POOL_MAX_IDLE_PER_ENDPOINT {
        idle.push(IdleConnection {
            idle_since: Instant::now(),
            stream,
        });
    }
}

#[allow(clippy::too_many_arguments)]
fn acquire_stream(
    key: &PoolKey,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    use_ssl: bool,
    timeout: Duration,
    retries: u8,
    allow_pooled: bool,
    metrics: &mut RouterOsNativePerformance,
) -> Result<(ApiStream, bool), String> {
    if allow_pooled {
        if let Some(stream) = take_idle_stream(key, timeout) {
            metrics.reused_connection_count += 1;
            return Ok((stream, true));
        }
    }
    let mut last_error = "router offline".to_string();
    for attempt in 0..=retries {
        if attempt > 0 {
            metrics.retry_count += 1;
        }
        match open_authenticated_stream(host, port, username, password, use_ssl, timeout, metrics) {
            Ok(stream) => return Ok((stream, false)),
            Err(error) => {
                last_error = error;
                if is_non_retryable(&last_error) {
                    break;
                }
            }
        }
    }
    Err(last_error)
}

/// Errors of a connection the router already closed; a timeout is excluded
/// because the command may have been executed.
fn is_stale_connection_error(error: &str) -> bool {
    let normalized = error.to_lowercase();
    normalized.starts_with("router offline")
        || normalized.contains("broken pipe")
        || normalized.contains("connection reset")
        || normalized.contains("connection aborted")
        || normalized.contains("unexpected eof")
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

struct ApiCommandOutcome {
    rows: Vec<ApiRow>,
    error: Option<String>,
    trap_count: usize,
}

fn read_response_outcome<S: Read + Write>(stream: &mut S) -> Result<ApiCommandOutcome, String> {
    let mut rows = Vec::new();
    let mut command_error = None;
    let mut trap_count = 0;

    loop {
        let words = read_sentence(stream)?;

        if words.is_empty() {
            continue;
        }

        match words[0].as_str() {
            "!done" => {
                return Ok(ApiCommandOutcome {
                    rows,
                    error: command_error,
                    trap_count,
                })
            }
            "!re" => rows.push(words_to_row(&words[1..])),
            // A trapped command is terminated by a separate !done sentence.
            // Consume it before the next command so batch responses cannot
            // become shifted from one voucher to another.
            "!trap" => {
                trap_count += 1;
                command_error = Some(map_trap(words_to_row(&words[1..])));
            }
            "!fatal" => return Err("router offline: fatal API response".to_string()),
            _ => {}
        }
    }
}

fn elapsed_ms(started_at: Instant) -> f64 {
    started_at.elapsed().as_secs_f64() * 1_000.0
}

fn is_fatal_response(error: &str) -> bool {
    error.to_lowercase().contains("fatal api response")
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

    format!("router rejected: {message}")
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
        || normalized.contains("router rejected:")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Cursor, Seek, SeekFrom};

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

    #[test]
    fn consumes_trap_terminator_before_reading_the_next_batch_response() {
        let mut stream = Cursor::new(Vec::<u8>::new());
        send_sentence(
            &mut stream,
            &[
                "!trap".to_string(),
                "=message=user already exists".to_string(),
            ],
        )
        .unwrap();
        send_sentence(&mut stream, &["!done".to_string()]).unwrap();
        send_sentence(
            &mut stream,
            &["!re".to_string(), "=name=654321".to_string()],
        )
        .unwrap();
        send_sentence(&mut stream, &["!done".to_string()]).unwrap();
        stream.seek(SeekFrom::Start(0)).unwrap();

        let trapped = read_response_outcome(&mut stream).unwrap();
        assert_eq!(trapped.error.as_deref(), Some("duplicate user"));
        assert_eq!(trapped.trap_count, 1);

        let following = read_response_outcome(&mut stream).unwrap();
        assert_eq!(following.error, None);
        assert_eq!(following.trap_count, 0);
        assert_eq!(
            following.rows[0].get("name").map(String::as_str),
            Some("654321")
        );
    }

    /// Minimal RouterOS API server: answers /login and any command with one
    /// row, counts accepted connections and can close after N commands.
    fn spawn_fake_router(
        close_after_commands: Option<usize>,
    ) -> (u16, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::net::TcpListener;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let connections = Arc::new(AtomicUsize::new(0));
        let counter = connections.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                counter.fetch_add(1, Ordering::SeqCst);
                std::thread::spawn(move || {
                    let mut commands = 0;
                    while let Ok(words) = read_sentence(&mut stream) {
                        if words.first().map(String::as_str) == Some("/login") {
                            send_sentence(&mut stream, &["!done".to_string()]).unwrap();
                            continue;
                        }
                        commands += 1;
                        send_sentence(&mut stream, &["!re".to_string(), "=name=ok".to_string()]).unwrap();
                        send_sentence(&mut stream, &["!done".to_string()]).unwrap();
                        if close_after_commands == Some(commands) {
                            break;
                        }
                    }
                });
            }
        });
        (port, connections)
    }

    fn call(port: u16, password: &str) -> MikroTikApiCallResponse {
        mikrotik_api_call_blocking(MikroTikApiRequest {
            host: "127.0.0.1".to_string(),
            port,
            username: "api".to_string(),
            password: password.to_string(),
            use_ssl: false,
            timeout_ms: Some(2000),
            retries: Some(0),
            command: "/system/identity/print".to_string(),
            params: None,
            queries: None,
        })
        .unwrap()
    }

    #[test]
    fn reuses_an_authenticated_connection_between_calls() {
        let (port, connections) = spawn_fake_router(None);
        for _ in 0..3 {
            let response = call(port, "secret-a");
            assert_eq!(response.error, None);
            assert_eq!(response.rows[0].get("name").map(String::as_str), Some("ok"));
        }
        assert_eq!(connections.load(std::sync::atomic::Ordering::SeqCst), 1);
        // Other credentials never reuse that session.
        assert_eq!(call(port, "secret-b").error, None);
        assert_eq!(connections.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn reconnects_transparently_when_the_router_closed_the_idle_connection() {
        let (port, connections) = spawn_fake_router(Some(1));
        assert_eq!(call(port, "secret").error, None);
        std::thread::sleep(Duration::from_millis(100));
        let second = call(port, "secret");
        assert_eq!(second.error, None);
        assert_eq!(connections.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
}
