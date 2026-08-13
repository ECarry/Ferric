use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use russh::client::{self, Handle};
use russh::keys::*;
use russh::{Channel, ChannelMsg, Disconnect};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::error::AppError;
use crate::protocol::ProtocolManager;

/// Path to the known_hosts file, set once during app startup.
static KNOWN_HOSTS_PATH: OnceLock<PathBuf> = OnceLock::new();
static KNOWN_HOSTS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Set the known_hosts file path. Called once from `lib.rs` setup.
pub fn set_known_hosts_path(path: PathBuf) {
    let _ = KNOWN_HOSTS_PATH.set(path);
}

/// Read the known_hosts JSON file: `{ "host:port": "SHA256:..." }`.
fn load_known_hosts() -> std::collections::BTreeMap<String, String> {
    let Some(path) = KNOWN_HOSTS_PATH.get() else {
        return std::collections::BTreeMap::new();
    };
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => std::collections::BTreeMap::new(),
    }
}

/// Persist the known_hosts map to disk.
fn save_known_hosts(map: &std::collections::BTreeMap<String, String>) -> std::io::Result<()> {
    let Some(path) = KNOWN_HOSTS_PATH.get() else {
        return Ok(());
    };
    let json = serde_json::to_vec_pretty(map).map_err(std::io::Error::other)?;
    let temp_path = path.with_extension("json.tmp");
    std::fs::write(&temp_path, json)?;
    std::fs::rename(temp_path, path)
}

fn default_protocol() -> String {
    "ssh".to_string()
}

/// Config sent from the frontend to open a connection.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfig {
    #[serde(default = "default_protocol")]
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub baud_rate: Option<u32>,
    #[serde(default)]
    pub data_bits: Option<u8>,
    #[serde(default)]
    pub parity: Option<String>,
    #[serde(default)]
    pub stop_bits: Option<u8>,
    /// "password" | "key"
    pub auth_type: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
    #[serde(default)]
    pub cols: Option<u32>,
    #[serde(default)]
    pub rows: Option<u32>,
}

/// Payload emitted to the frontend as the shell produces output.
#[derive(Clone, Serialize)]
struct OutputPayload {
    id: String,
    /// Raw bytes; the frontend reconstructs a Uint8Array for xterm.
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
struct ClosedPayload {
    id: String,
}

/// Messages sent from commands into a running session's event loop.
enum InputMsg {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

/// Holds the input channel for each live session, keyed by session id.
#[derive(Default)]
pub struct SshManager {
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>>,
}

/// russh client handler with TOFU (Trust On First Use) host key verification.
pub(crate) struct Client {
    host: String,
    port: u16,
}

impl Client {
    fn key_for(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();
        let key = self.key_for();

        let lock = KNOWN_HOSTS_LOCK.get_or_init(Mutex::default);
        let _guard = lock
            .lock()
            .map_err(|_| russh::Error::IO(std::io::Error::other("known_hosts lock poisoned")))?;
        let mut hosts = load_known_hosts();
        match hosts.get(&key) {
            Some(known_fp) if known_fp == &fp => {
                // Key matches — accept.
                Ok(true)
            }
            Some(_known_fp) => {
                // Key changed — reject (possible MITM).
                log::warn!(
                    "Host key changed for {}: expected {}, got {}",
                    key,
                    _known_fp,
                    fp
                );
                Ok(false)
            }
            None => {
                // First connection — trust and store (TOFU).
                hosts.insert(key, fp);
                if let Err(error) = save_known_hosts(&hosts) {
                    log::error!("Failed to persist known host: {error}");
                    return Ok(false);
                }
                Ok(true)
            }
        }
    }
}

/// Connect to the host and authenticate, returning the live session handle.
/// Shared by the interactive shell and the SFTP subsystem.
const SSH_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub(crate) async fn connect_and_auth(cfg: &ConnectConfig) -> anyhow::Result<Handle<Client>> {
    let host = cfg.host.trim();
    let config = Arc::new(client::Config::default());
    let client = Client {
        host: host.to_string(),
        port: cfg.port,
    };
    let connect_fut = client::connect(config, (host, cfg.port), client);
    let mut session = tokio::time::timeout(SSH_CONNECT_TIMEOUT, connect_fut)
        .await
        .map_err(|_| {
            AppError::new("errSshConnectTimeout")
                .param("host", &cfg.host)
                .param("port", cfg.port)
        })?
        .map_err(|e| {
            AppError::new("errSshConnect")
                .param("host", &cfg.host)
                .param("port", cfg.port)
                .detail(e)
        })?;

    let auth_fut = async {
        let authenticated = match cfg.auth_type.as_str() {
            "key" => {
                let path = cfg
                    .key_path
                    .as_ref()
                    .ok_or_else(|| AppError::new("errSshNoKeyPath"))?;
                let key_pair = load_secret_key(path, cfg.key_passphrase.as_deref())
                    .map_err(|e| AppError::new("errSshKeyLoad").detail(e))?;
                let hash = session.best_supported_rsa_hash().await?.flatten();
                session
                    .authenticate_publickey(
                        &cfg.username,
                        PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash),
                    )
                    .await
                    .map_err(|e| AppError::new("errSshAuthProcess").detail(e))?
                    .success()
            }
            _ => {
                let password = cfg
                    .password
                    .as_ref()
                    .ok_or_else(|| AppError::new("errSshNoPassword"))?;
                session
                    .authenticate_password(&cfg.username, password)
                    .await
                    .map_err(|e| AppError::new("errSshAuthProcess").detail(e))?
                    .success()
            }
        };
        if authenticated {
            Ok(())
        } else {
            Err(AppError::new("errSshAuthFailed"))
        }
    };

    tokio::time::timeout(SSH_CONNECT_TIMEOUT, auth_fut)
        .await
        .map_err(|_| AppError::new("errSshAuthTimeout").param("host", &cfg.host))??;

    Ok(session)
}

/// Establish the SSH session, authenticate, and open an interactive PTY+shell.
async fn establish(cfg: &ConnectConfig) -> anyhow::Result<(Handle<Client>, Channel<client::Msg>)> {
    let session = connect_and_auth(cfg).await?;

    let channel = session.channel_open_session().await?;
    channel
        .request_pty(
            false,
            "xterm-256color",
            cfg.cols.unwrap_or(80),
            cfg.rows.unwrap_or(24),
            0,
            0,
            &[],
        )
        .await?;
    channel.request_shell(true).await?;

    Ok((session, channel))
}

/// The per-session event loop: forwards frontend input to the shell and
/// emits shell output back to the frontend.
async fn run_loop(
    app: AppHandle,
    id: String,
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>>,
    session: Handle<Client>,
    mut channel: Channel<client::Msg>,
    mut rx: mpsc::UnboundedReceiver<InputMsg>,
) {
    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(InputMsg::Data(data)) => {
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(InputMsg::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(InputMsg::Close) | None => {
                        let _ = channel.eof().await;
                        break;
                    }
                }
            }
            server_msg = channel.wait() => {
                match server_msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        let _ = app.emit(
                            "ssh:data",
                            OutputPayload { id: id.clone(), data: data.to_vec() },
                        );
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        let _ = app.emit(
                            "ssh:data",
                            OutputPayload { id: id.clone(), data: data.to_vec() },
                        );
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }

    let _ = session
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;
    if let Ok(mut sessions) = sessions.lock() {
        sessions.remove(&id);
    }
    let _ = app.emit("ssh:closed", ClosedPayload { id });
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, SshManager>,
    config: ConnectConfig,
) -> Result<String, AppError> {
    let (session, channel) = establish(&config).await.map_err(AppError::from)?;

    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::unbounded_channel();

    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), tx);

    let app_handle = app.clone();
    let loop_id = id.clone();
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn(async move {
        run_loop(app_handle, loop_id, sessions, session, channel, rx).await;
    });

    Ok(id)
}

#[tauri::command]
pub fn ssh_send_input(
    state: State<'_, SshManager>,
    protocol_state: State<'_, ProtocolManager>,
    id: String,
    data: String,
) -> Result<(), AppError> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| AppError::new("errUnknown").detail(e))?;
    if let Some(tx) = sessions.get(&id) {
        tx.send(InputMsg::Data(data.as_bytes().to_vec()))
            .map_err(|_| AppError::new("errSshSessionClosed"))?;
        return Ok(());
    }
    drop(sessions);
    protocol_state.send_input(&id, data)
}

#[tauri::command]
pub fn ssh_resize(
    state: State<'_, SshManager>,
    protocol_state: State<'_, ProtocolManager>,
    id: String,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| AppError::new("errUnknown").detail(e))?;
    let Some(tx) = sessions.get(&id) else {
        drop(sessions);
        let _ = (protocol_state, cols, rows);
        return Ok(());
    };
    tx.send(InputMsg::Resize { cols, rows })
        .map_err(|_| AppError::new("errSshSessionClosed"))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_disconnect(
    state: State<'_, SshManager>,
    protocol_state: State<'_, ProtocolManager>,
    id: String,
) -> Result<(), AppError> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = sessions.remove(&id) {
        let _ = tx.send(InputMsg::Close);
        return Ok(());
    }
    drop(sessions);
    protocol_state.disconnect(&id)
}
