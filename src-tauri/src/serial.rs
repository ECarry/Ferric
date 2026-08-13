use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serialport::{DataBits, Parity, StopBits};
use tauri::AppHandle;
use tokio::sync::mpsc;

use crate::error::AppError;

use crate::protocol::{close_session, emit_data, InputMsg};

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<String>, AppError> {
    let mut ports = serialport::available_ports()
        .map_err(|error| AppError::new("errSerialListPorts").detail(error))?
        .into_iter()
        .map(|port| port.port_name)
        .collect::<Vec<_>>();
    ports.sort();
    Ok(ports)
}

pub(crate) fn connect(
    app: AppHandle,
    id: String,
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<InputMsg>>>>,
    device: String,
    baud_rate: u32,
    data_bits: u8,
    parity: &str,
    stop_bits: u8,
    mut rx: mpsc::UnboundedReceiver<InputMsg>,
) {
    let data_bits = match data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let parity = match parity {
        "odd" => Parity::Odd,
        "even" => Parity::Even,
        _ => Parity::None,
    };
    let stop_bits = if stop_bits == 2 {
        StopBits::Two
    } else {
        StopBits::One
    };
    let mut port = match serialport::new(&device, baud_rate)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .timeout(Duration::from_millis(100))
        .open()
    {
        Ok(port) => port,
        Err(error) => {
            log::error!("Failed to open serial device {device}: {error}");
            close_session(&app, &id, &sessions);
            return;
        }
    };
    let (input_tx, input_rx) = std::sync::mpsc::channel::<InputMsg>();
    let input_thread = std::thread::spawn(move || {
        while let Some(message) = rx.blocking_recv() {
            let should_close = matches!(message, InputMsg::Close);
            if input_tx.send(message).is_err() || should_close {
                break;
            }
        }
    });
    let mut buffer = [0_u8; 8192];
    loop {
        match input_rx.recv_timeout(Duration::from_millis(20)) {
            Ok(InputMsg::Data(data)) => {
                if port.write_all(&data).is_err() {
                    break;
                }
                let _ = port.flush();
            }
            Ok(InputMsg::Close) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
        match port.read(&mut buffer) {
            Ok(size) => emit_data(&app, &id, buffer[..size].to_vec()),
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => break,
        }
    }
    drop(input_rx);
    let _ = input_thread.join();
    close_session(&app, &id, &sessions);
}
