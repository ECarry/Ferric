use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::error::AppError;
use crate::ssh::{connect_and_auth, ConnectConfig};

/// A running port-forward tunnel.
struct Tunnel {
    /// Cancellation handle — dropping this aborts the accept loop task.
    cancel: tokio::sync::oneshot::Sender<()>,
}

/// Manages active port-forward tunnels, keyed by tunnel id.
#[derive(Default)]
pub struct ForwardManager {
    tunnels: Mutex<HashMap<String, Tunnel>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardConfig {
    /// The SSH server config to connect through.
    pub config: ConnectConfig,
    /// Local port to listen on.
    pub local_port: u16,
    /// Remote host to forward to (as seen by the SSH server).
    pub remote_host: String,
    /// Remote port to forward to.
    pub remote_port: u16,
}

#[derive(Clone, Serialize)]
struct ForwardEventPayload {
    id: String,
    /// "started" | "stopped" | "connected" | "disconnected" | "error"
    event: String,
    message: Option<String>,
}

fn emit_event(app: &AppHandle, id: &str, event: &str, message: Option<String>) {
    let _ = app.emit(
        "ssh:forward-event",
        ForwardEventPayload {
            id: id.to_string(),
            event: event.to_string(),
            message,
        },
    );
}

/// Start a local port-forward tunnel.
///
/// Listens on `local_port` and for each incoming TCP connection opens a
/// `direct-tcpip` channel through the SSH server to `remote_host:remote_port`.
#[tauri::command]
pub async fn ssh_forward_start(
    app: AppHandle,
    state: State<'_, ForwardManager>,
    config: ForwardConfig,
) -> Result<String, AppError> {
    // Bind the local listener first so we fail fast if the port is in use.
    let listener = TcpListener::bind(("127.0.0.1", config.local_port))
        .await
        .map_err(|e| {
            AppError::new("errForwardBind")
                .param("port", config.local_port)
                .detail(e)
        })?;

    let local_port = listener.local_addr().map(|a| a.port()).unwrap_or(config.local_port);

    // Establish the SSH connection that will carry the tunnels.
    let session = connect_and_auth(&config.config).await.map_err(AppError::from)?;

    let id = uuid::Uuid::new_v4().to_string();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

    let tunnel_id = id.clone();
    let app_handle = app.clone();
    let remote_host = config.remote_host.clone();
    let remote_port = config.remote_port;

    tauri::async_runtime::spawn(async move {
        emit_event(&app_handle, &tunnel_id, "started", Some(format!("Listening on 127.0.0.1:{local_port} -> {remote_host}:{remote_port}")));

        let session = Arc::new(session);
        let mut cancel = cancel_rx;

        loop {
            tokio::select! {
                _ = &mut cancel => break,
                accept = listener.accept() => {
                    let (tcp, peer) = match accept {
                        Ok(v) => v,
                        Err(e) => {
                            emit_event(&app_handle, &tunnel_id, "error", Some(format!("Accept error: {e}")));
                            break;
                        }
                    };

                    let session = session.clone();
                    let app = app_handle.clone();
                    let tid = tunnel_id.clone();
                    let rh = remote_host.clone();
                    let rp = remote_port;

                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = handle_connection(session, tcp, peer, rh, rp).await {
                            emit_event(&app, &tid, "error", Some(format!("Channel error: {e}")));
                        }
                    });
                }
            }
        }

        // Cleanup: disconnect the SSH session.
        let _ = Arc::try_unwrap(session).map(|s| {
            tauri::async_runtime::spawn(async move {
                let _ = s.disconnect(russh::Disconnect::ByApplication, "", "English").await;
            });
        });
        emit_event(&app_handle, &tunnel_id, "stopped", None);
    });

    state
        .tunnels
        .lock()
        .map_err(|e| AppError::new("errUnknown").detail(e))?
        .insert(id.clone(), Tunnel { cancel: cancel_tx });

    Ok(id)
}

/// Stop a running port-forward tunnel by its id.
#[tauri::command]
pub fn ssh_forward_stop(
    state: State<'_, ForwardManager>,
    id: String,
) -> Result<(), AppError> {
    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|e| AppError::new("errUnknown").detail(e))?;
    if let Some(tunnel) = tunnels.remove(&id) {
        let _ = tunnel.cancel.send(());
    }
    Ok(())
}

/// Stop all tunnels (called on disconnect).
#[tauri::command]
pub fn ssh_forward_stop_all(
    state: State<'_, ForwardManager>,
) -> Result<(), AppError> {
    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|e| AppError::new("errUnknown").detail(e))?;
    for (_, tunnel) in tunnels.drain() {
        let _ = tunnel.cancel.send(());
    }
    Ok(())
}

/// List active tunnel ids.
#[tauri::command]
pub fn ssh_forward_list(
    state: State<'_, ForwardManager>,
) -> Result<Vec<String>, AppError> {
    let tunnels = state
        .tunnels
        .lock()
        .map_err(|e| AppError::new("errUnknown").detail(e))?;
    Ok(tunnels.keys().cloned().collect())
}

/// Forward a single TCP connection through an SSH `direct-tcpip` channel.
async fn handle_connection(
    session: Arc<russh::client::Handle<crate::ssh::Client>>,
    mut tcp: TcpStream,
    peer: SocketAddr,
    remote_host: String,
    remote_port: u16,
) -> anyhow::Result<()> {
    let mut channel = session
        .channel_open_direct_tcpip(&remote_host, remote_port as u32, peer.ip().to_string(), peer.port() as u32)
        .await?;

    let mut tcp_buf = vec![0u8; 32 * 1024];

    loop {
        tokio::select! {
            // TCP -> SSH channel
            n = tcp.read(&mut tcp_buf) => {
                let n = n?;
                if n == 0 {
                    let _ = channel.eof().await;
                    break;
                }
                channel.data(&tcp_buf[..n]).await?;
            }
            // SSH channel -> TCP
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        if tcp.write_all(data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        let _ = tcp.shutdown().await;
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}
