use russh::ChannelMsg;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::ssh::{connect_and_auth, ConnectConfig};

const COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const MAX_OUTPUT: usize = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteService {
    pub name: String,
    pub load: String,
    pub active: String,
    pub sub: String,
    pub description: String,
}

async fn exec_remote(config: &ConnectConfig, command: &str) -> Result<String, AppError> {
    let session = connect_and_auth(config).await.map_err(AppError::from)?;
    let result = async {
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| AppError::new("errServiceChannel").detail(e))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| AppError::new("errServiceCommand").detail(e))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_status = None;
        let deadline = tokio::time::sleep(COMMAND_TIMEOUT);
        tokio::pin!(deadline);
        while let Some(message) = tokio::select! {
            _ = &mut deadline => return Err(AppError::new("errServiceTimeout")),
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
                ChannelMsg::ExitStatus { exit_status: status } => exit_status = Some(status),
                _ => {}
            }
        }

        let output = String::from_utf8_lossy(&stdout).trim().to_string();
        if exit_status.is_some_and(|status| status != 0) {
            let detail = String::from_utf8_lossy(&stderr).trim().to_string();
            return Err(AppError::new("errServiceCommandFailed").detail(detail));
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
pub async fn list_remote_services(config: ConnectConfig) -> Result<Vec<RemoteService>, AppError> {
    let output = exec_remote(
        &config,
        "systemctl list-units --type=service --all --no-legend --no-pager",
    )
    .await?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 4 || !fields[0].ends_with(".service") {
                return None;
            }
            Some(RemoteService {
                name: fields[0].to_string(),
                load: fields[1].to_string(),
                active: fields[2].to_string(),
                sub: fields[3].to_string(),
                description: fields[4..].join(" "),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn control_remote_service(
    config: ConnectConfig,
    service: String,
    action: String,
) -> Result<(), AppError> {
    if !service
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || ".@_:-".contains(character))
        || !service.ends_with(".service")
    {
        return Err(AppError::new("errInvalidServiceName"));
    }
    let action = match action.as_str() {
        "start" | "stop" | "restart" => action,
        _ => return Err(AppError::new("errInvalidServiceAction")),
    };
    exec_remote(&config, &format!("systemctl {action} -- {service}")).await?;
    Ok(())
}
