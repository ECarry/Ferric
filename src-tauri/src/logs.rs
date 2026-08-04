use russh::ChannelMsg;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::ssh::{connect_and_auth, ConnectConfig};

const COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const MAX_OUTPUT: usize = 5 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLog {
    pub id: String,
    pub label: String,
    pub path: Option<String>,
    pub kind: String,
}

const LOG_SOURCES: &[(&str, &str, &str, &str)] = &[
    ("syslog", "System log", "/var/log/syslog", "file"),
    ("messages", "System messages", "/var/log/messages", "file"),
    ("auth", "Authentication log", "/var/log/auth.log", "file"),
    ("secure", "Security log", "/var/log/secure", "file"),
    ("kern", "Kernel log", "/var/log/kern.log", "file"),
    ("dmesg", "Kernel ring buffer", "/var/log/dmesg", "file"),
];

fn source_by_id(id: &str) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
    LOG_SOURCES.iter().copied().find(|source| source.0 == id)
}

async fn exec_remote(config: &ConnectConfig, command: &str) -> Result<String, AppError> {
    let session = connect_and_auth(config).await.map_err(AppError::from)?;
    let result = async {
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| AppError::new("errLogChannel").detail(e))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| AppError::new("errLogCommand").detail(e))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_status = None;
        let deadline = tokio::time::sleep(COMMAND_TIMEOUT);
        tokio::pin!(deadline);
        while let Some(message) = tokio::select! {
            _ = &mut deadline => return Err(AppError::new("errLogTimeout")),
            message = channel.wait() => message,
        } {
            match message {
                ChannelMsg::Data { data } => {
                    if stdout.len().saturating_add(data.len()) > MAX_OUTPUT {
                        return Err(AppError::new("errRemoteOutputTooLarge"));
                    }
                    stdout.extend_from_slice(&data);
                }
                ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                    if stderr.len().saturating_add(data.len()) > MAX_OUTPUT {
                        return Err(AppError::new("errRemoteOutputTooLarge"));
                    }
                    stderr.extend_from_slice(&data);
                }
                ChannelMsg::ExitStatus {
                    exit_status: status,
                } => exit_status = Some(status),
                _ => {}
            }
        }

        let output = String::from_utf8_lossy(&stdout).to_string();
        if exit_status.is_some_and(|status| status != 0) {
            let detail = String::from_utf8_lossy(&stderr).trim().to_string();
            return Err(AppError::new("errLogRead").detail(detail));
        }
        Ok(output)
    }
    .await;

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "English")
        .await;
    result
}

#[tauri::command]
pub async fn list_remote_logs(config: ConnectConfig) -> Result<Vec<RemoteLog>, AppError> {
    let files = LOG_SOURCES
        .iter()
        .map(|(_, _, path, _)| *path)
        .collect::<Vec<_>>();
    let checks = files
        .iter()
        .map(|path| format!("[ -r '{}' ] && printf '%s\\n' '{}'", path, path))
        .collect::<Vec<_>>()
        .join("; ");
    let checks = format!("{checks}; true");
    let output = exec_remote(&config, &checks).await?;
    let available_paths = output.lines().collect::<std::collections::HashSet<_>>();
    let mut logs = LOG_SOURCES
        .iter()
        .filter(|(_, _, path, _)| available_paths.contains(path))
        .map(|(id, label, path, kind)| RemoteLog {
            id: (*id).to_string(),
            label: (*label).to_string(),
            path: Some((*path).to_string()),
            kind: (*kind).to_string(),
        })
        .collect::<Vec<_>>();

    let journal_available = exec_remote(&config, "command -v journalctl >/dev/null 2>&1")
        .await
        .is_ok();
    if journal_available {
        logs.push(RemoteLog {
            id: "journal".to_string(),
            label: "System journal".to_string(),
            path: None,
            kind: "journal".to_string(),
        });
    }
    Ok(logs)
}

#[tauri::command]
pub async fn read_remote_log(
    config: ConnectConfig,
    log_id: String,
    lines: u32,
) -> Result<String, AppError> {
    let lines = lines.clamp(50, 10_000);
    let command = if log_id == "journal" {
        format!("journalctl --no-pager -n {lines} -o short-iso")
    } else if let Some((_, _, path, _)) = source_by_id(&log_id) {
        format!("tail -n {lines} -- '{}'", path)
    } else {
        return Err(AppError::new("errInvalidLog"));
    };
    exec_remote(&config, &command).await
}
