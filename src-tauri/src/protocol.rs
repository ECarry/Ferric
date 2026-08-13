use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::error::AppError;
use crate::serial;
use crate::ssh::ConnectConfig;
use crate::telnet;

#[derive(Clone, Serialize)]
struct DataPayload {
    id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
struct ClosedPayload {
    id: String,
}

pub(crate) enum InputMsg {
    Data(Vec<u8>),
    Close,
}

#[derive(Default)]
pub struct ProtocolManager {
    pub(crate) sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>>,
}

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn emit_data(app: &AppHandle, id: &str, data: Vec<u8>) {
    if !data.is_empty() {
        let _ = app.emit(
            "ssh:data",
            DataPayload {
                id: id.to_string(),
                data,
            },
        );
    }
}

pub(crate) fn close_session(
    app: &AppHandle,
    id: &str,
    sessions: &Arc<Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>>,
) {
    if let Ok(mut sessions) = sessions.lock() {
        sessions.remove(id);
    }
    let _ = app.emit("ssh:closed", ClosedPayload { id: id.to_string() });
}

impl ProtocolManager {
    pub(crate) fn send_input(&self, id: &str, data: String) -> Result<(), AppError> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|e| AppError::new("errUnknown").detail(e))?;
        sessions
            .get(id)
            .ok_or_else(|| AppError::new("errSshNoSession"))?
            .send(InputMsg::Data(data.into_bytes()))
            .map_err(|_| AppError::new("errSshSessionClosed"))?;
        Ok(())
    }

    pub(crate) fn disconnect(&self, id: &str) -> Result<(), AppError> {
        let tx = self
            .sessions
            .lock()
            .map_err(|e| AppError::new("errUnknown").detail(e))?
            .remove(id)
            .ok_or_else(|| AppError::new("errSshNoSession"))?;
        let _ = tx.send(InputMsg::Close);
        Ok(())
    }
}

#[tauri::command]
pub async fn protocol_connect(
    app: AppHandle,
    state: State<'_, ProtocolManager>,
    config: ConnectConfig,
) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::unbounded_channel();
    state
        .sessions
        .lock()
        .map_err(|e| AppError::new("errUnknown").detail(e))?
        .insert(id.clone(), tx);
    let sessions = Arc::clone(&state.sessions);

    match config.protocol.as_str() {
        "serial" => {
            let device = config.host.trim().to_string();
            let baud_rate = config.baud_rate.unwrap_or(115_200);
            let data_bits = config.data_bits.unwrap_or(8);
            let parity = config.parity.unwrap_or_else(|| "none".to_string());
            let stop_bits = config.stop_bits.unwrap_or(1);
            let loop_id = id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                serial::connect(
                    app, loop_id, sessions, device, baud_rate, data_bits, &parity, stop_bits, rx,
                )
            });
        }
        "telnet" => {
            let host = config.host.trim().to_string();
            let port = config.port;
            let loop_id = id.clone();
            tauri::async_runtime::spawn(async move {
                telnet::connect(app, loop_id, sessions, host, port, rx).await;
            });
        }
        _ => return Err(AppError::new("errUnsupportedProtocol")),
    }
    Ok(id)
}

#[tauri::command]
pub fn protocol_send_input(
    state: State<'_, ProtocolManager>,
    id: String,
    data: String,
) -> Result<(), AppError> {
    state.send_input(&id, data)
}

#[tauri::command]
pub fn protocol_disconnect(state: State<'_, ProtocolManager>, id: String) -> Result<(), AppError> {
    state.disconnect(&id)
}
