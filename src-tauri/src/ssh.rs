use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use russh::client::{self, Handle};
use russh::keys::*;
use russh::{Channel, ChannelMsg, Disconnect};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

/// Config sent from the frontend to open a connection.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
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
    sessions: Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>,
}

/// russh client handler. We accept any server key here for simplicity;
/// a production client should verify against a known_hosts store.
pub(crate) struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Connect to the host and authenticate, returning the live session handle.
/// Shared by the interactive shell and the SFTP subsystem.
pub(crate) async fn connect_and_auth(cfg: &ConnectConfig) -> anyhow::Result<Handle<Client>> {
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (cfg.host.as_str(), cfg.port), Client)
        .await
        .map_err(|e| {
            anyhow::anyhow!(
                "无法连接到 {}:{}（请检查主机地址、端口与网络连接）：{}",
                cfg.host,
                cfg.port,
                e
            )
        })?;

    let authenticated = match cfg.auth_type.as_str() {
        "key" => {
            let path = cfg
                .key_path
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("未提供私钥路径"))?;
            let key_pair = load_secret_key(path, cfg.key_passphrase.as_deref()).map_err(|e| {
                anyhow::anyhow!("私钥加载失败（文件不存在、格式不支持或口令不正确）：{}", e)
            })?;
            let hash = session.best_supported_rsa_hash().await?.flatten();
            session
                .authenticate_publickey(
                    &cfg.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash),
                )
                .await
                .map_err(|e| anyhow::anyhow!("认证过程出错：{}", e))?
                .success()
        }
        _ => {
            let password = cfg
                .password
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("未提供密码"))?;
            session
                .authenticate_password(&cfg.username, password)
                .await
                .map_err(|e| anyhow::anyhow!("认证过程出错：{}", e))?
                .success()
        }
    };

    if !authenticated {
        anyhow::bail!("认证失败：用户名、密码或密钥不正确");
    }

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
    let _ = app.emit("ssh:closed", ClosedPayload { id });
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, SshManager>,
    config: ConnectConfig,
) -> Result<String, String> {
    let (session, channel) = establish(&config).await.map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::unbounded_channel();

    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), tx);

    let app_handle = app.clone();
    let loop_id = id.clone();
    tauri::async_runtime::spawn(async move {
        run_loop(app_handle, loop_id, session, channel, rx).await;
    });

    Ok(id)
}

#[tauri::command]
pub fn ssh_send_input(
    state: State<'_, SshManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = sessions.get(&id) {
        tx.send(InputMsg::Data(data.into_bytes()))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_resize(
    state: State<'_, SshManager>,
    id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = sessions.get(&id) {
        let _ = tx.send(InputMsg::Resize { cols, rows });
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_disconnect(state: State<'_, SshManager>, id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = sessions.remove(&id) {
        let _ = tx.send(InputMsg::Close);
    }
    Ok(())
}
