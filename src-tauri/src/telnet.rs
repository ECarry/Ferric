use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

use crate::protocol::{close_session, emit_data, InputMsg};

async fn handle_telnet_data<W: AsyncWrite + Unpin>(data: &[u8], writer: &mut W) -> Vec<u8> {
    const IAC: u8 = 255;
    const WILL: u8 = 251;
    const WONT: u8 = 252;
    const DO: u8 = 253;
    const DONT: u8 = 254;
    let mut output = Vec::with_capacity(data.len());
    let mut index = 0;
    while index < data.len() {
        if data[index] != IAC || index + 1 >= data.len() {
            output.push(data[index]);
            index += 1;
            continue;
        }
        let command = data[index + 1];
        if command == IAC {
            output.push(IAC);
            index += 2;
        } else if matches!(command, WILL | WONT | DO | DONT) && index + 2 < data.len() {
            let response = if matches!(command, WILL | WONT) {
                DONT
            } else {
                WONT
            };
            let _ = writer.write_all(&[IAC, response, data[index + 2]]).await;
            index += 3;
        } else {
            index += 2;
        }
    }
    output
}

pub(crate) async fn connect(
    app: AppHandle,
    id: String,
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>>,
    host: String,
    port: u16,
    rx: mpsc::UnboundedReceiver<InputMsg>,
) {
    match tokio::time::timeout(
        super::protocol::CONNECT_TIMEOUT,
        TcpStream::connect((host.as_str(), port)),
    )
    .await
    {
        Ok(Ok(stream)) => run(app, id, sessions, stream, rx).await,
        _ => close_session(&app, &id, &sessions),
    }
}

async fn run(
    app: AppHandle,
    id: String,
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>>,
    stream: TcpStream,
    mut rx: mpsc::UnboundedReceiver<InputMsg>,
) {
    let (mut reader, mut writer) = stream.into_split();
    let mut buffer = [0_u8; 8192];
    loop {
        tokio::select! {
            message = rx.recv() => match message {
                Some(InputMsg::Data(data)) => if writer.write_all(&data).await.is_err() { break },
                Some(InputMsg::Close) | None => { let _ = writer.shutdown().await; break },
            },
            result = reader.read(&mut buffer) => match result {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let data = handle_telnet_data(&buffer[..size], &mut writer).await;
                    emit_data(&app, &id, data);
                }
            }
        }
    }
    close_session(&app, &id, &sessions);
}
