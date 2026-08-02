use russh::ChannelMsg;
use serde::{Deserialize, Serialize};

// 复用项目现有的 SSH 配置与连接认证
use crate::error::AppError;
use crate::ssh::{connect_and_auth, ConnectConfig};

const REMOTE_COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const MAX_COMMAND_OUTPUT: usize = 5 * 1024 * 1024;

/// 返回给前端的容器信息
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub image: String,
    pub command: String,
    pub created_at: String,
    pub status: String,
    pub names: String,
}

/// Values accepted when creating a detached container.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateContainerInput {
    pub name: Option<String>,
    pub image: String,
    pub command: Option<String>,
}

/// 返回给前端的 Docker 版本与系统信息
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DockerInfo {
    pub version: String,
    pub api_version: String,
    pub os: String,
    pub arch: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerVersionRow {
    version: Option<String>,
    api_version: Option<String>,
    os: Option<String>,
    arch: Option<String>,
}

/// JSON emitted by `docker ps --format '{{json .}}'`.
#[derive(Deserialize)]
struct DockerPsRow {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "Command")]
    command: String,
    #[serde(rename = "CreatedAt")]
    created_at: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Names")]
    names: String,
}

/// 在远程 SSH 通道中执行单个命令并获取 stdout。
/// 若命令返回非 0 退出码，将 stdout + stderr 一并返回给前端提示。
async fn exec_remote_cmd(config: &ConnectConfig, cmd: &str) -> Result<String, AppError> {
    // Propagate the structured connection/auth error untouched.
    let session = connect_and_auth(config).await.map_err(AppError::from)?;

    let result = exec_on_session(&session, cmd).await?;

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "English")
        .await;

    Ok(result)
}

/// Run a command on an existing session and collect stdout/stderr/exit.
async fn exec_on_session(
    session: &russh::client::Handle<crate::ssh::Client>,
    cmd: &str,
) -> Result<String, AppError> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| AppError::new("errSshChannel").detail(e))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| AppError::new("errDockerExec").detail(e))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_status: Option<u32> = None;

    let deadline = tokio::time::sleep(REMOTE_COMMAND_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        let msg = tokio::select! {
            _ = &mut deadline => {
                return Err(AppError::new("errRemoteCommandTimeout"));
            }
            msg = channel.wait() => msg,
        };
        let Some(msg) = msg else { break };
        match msg {
            ChannelMsg::Data { data } => {
                if stdout.len().saturating_add(data.len()) > MAX_COMMAND_OUTPUT {
                    return Err(AppError::new("errRemoteOutputTooLarge"));
                }
                stdout.extend_from_slice(&data);
            }
            ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                if stderr.len().saturating_add(data.len()) > MAX_COMMAND_OUTPUT {
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

    let stdout_str = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&stderr).trim().to_string();

    if matches!(exit_status, Some(status) if status != 0) {
        return Err(AppError::new("errDockerCommandFailed")
            .param("exit", exit_status.unwrap_or_default())
            .detail(format!("{stdout_str} {stderr_str}").trim()));
    }

    Ok(stdout_str)
}

/// Run multiple commands on a single SSH session, returning each command's stdout.
async fn exec_remote_batch(
    config: &ConnectConfig,
    cmds: &[&str],
) -> Result<Vec<String>, AppError> {
    let session = connect_and_auth(config).await.map_err(AppError::from)?;

    let mut results = Vec::with_capacity(cmds.len());
    for cmd in cmds {
        results.push(exec_on_session(&session, cmd).await?);
    }

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "English")
        .await;

    Ok(results)
}

fn is_valid_container_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// Quote one argument for the remote POSIX shell. This keeps user-provided
/// image names and commands as Docker arguments rather than shell syntax.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// 1. 获取远程 Docker 版本信息
#[tauri::command]
pub async fn get_remote_docker_version(config: ConnectConfig) -> Result<DockerInfo, AppError> {
    let cmd = "docker version --format '{{json .Server}}'";

    let raw_json = exec_remote_cmd(&config, cmd).await?;

    let parsed: DockerVersionRow = serde_json::from_str(raw_json.trim()).map_err(|e| {
        AppError::new("errDockerParse").detail(format!("{e} (raw: {raw_json})"))
    })?;

    Ok(DockerInfo {
        version: parsed.version.unwrap_or_else(|| "Unknown".to_string()),
        api_version: parsed.api_version.unwrap_or_else(|| "Unknown".to_string()),
        os: parsed.os.unwrap_or_else(|| "Unknown".to_string()),
        arch: parsed.arch.unwrap_or_else(|| "Unknown".to_string()),
    })
}

/// 1+2. Fetch Docker version and container list in a single SSH session.
#[tauri::command]
pub async fn get_remote_docker_info(
    config: ConnectConfig,
    all: bool,
) -> Result<(DockerInfo, Vec<DockerContainer>), AppError> {
    let version_cmd = "docker version --format '{{json .Server}}'";
    let all_flag = if all { "-a" } else { "" };
    let ps_cmd = format!("docker ps {} --format '{{{{json .}}}}'", all_flag);

    let results = exec_remote_batch(&config, &[version_cmd, &ps_cmd]).await?;
    let raw_json = &results[0];
    let raw_output = &results[1];

    let parsed: DockerVersionRow = serde_json::from_str(raw_json.trim()).map_err(|e| {
        AppError::new("errDockerParse").detail(format!("{e} (raw: {raw_json})"))
    })?;

    let info = DockerInfo {
        version: parsed.version.unwrap_or_else(|| "Unknown".to_string()),
        api_version: parsed.api_version.unwrap_or_else(|| "Unknown".to_string()),
        os: parsed.os.unwrap_or_else(|| "Unknown".to_string()),
        arch: parsed.arch.unwrap_or_else(|| "Unknown".to_string()),
    };

    let mut containers = Vec::new();
    for line in raw_output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let row: DockerPsRow = serde_json::from_str(line).map_err(|e| {
            AppError::new("errDockerParse").detail(format!("{e} (raw: {line})"))
        })?;
        containers.push(DockerContainer {
            id: row.id,
            image: row.image,
            command: row.command,
            created_at: row.created_at,
            status: row.status,
            names: row.names,
        });
    }

    Ok((info, containers))
}

/// 2. 获取远程 Docker 容器列表
#[tauri::command]
pub async fn list_remote_containers(
    config: ConnectConfig,
    all: bool,
) -> Result<Vec<DockerContainer>, AppError> {
    let all_flag = if all { "-a" } else { "" };
    // Docker provides correctly escaped JSON for each row.
    let cmd = format!("docker ps {} --format '{{{{json .}}}}'", all_flag);

    let raw_output = exec_remote_cmd(&config, &cmd).await?;

    let mut containers = Vec::new();

    // 按行解析多行 JSON 字符串
    for line in raw_output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let row: DockerPsRow = serde_json::from_str(line).map_err(|e| {
            AppError::new("errDockerParse").detail(format!("{e} (raw: {line})"))
        })?;
        containers.push(DockerContainer {
            id: row.id,
            image: row.image,
            command: row.command,
            created_at: row.created_at,
            status: row.status,
            names: row.names,
        });
    }

    Ok(containers)
}

/// 3. 控制远程容器（启动 / 停止 / 重启）
#[tauri::command]
pub async fn control_remote_container(
    config: ConnectConfig,
    container_id: String,
    action: String, // "start" | "stop" | "restart"
) -> Result<(), AppError> {
    let valid_actions = ["start", "stop", "restart"];
    if !valid_actions.contains(&action.as_str()) {
        return Err(AppError::new("errDockerBadAction"));
    }

    // This value is interpolated into a shell command, so permit only valid
    // Docker name / ID characters.
    if !is_valid_container_name(&container_id) {
        return Err(AppError::new("errDockerBadContainerId"));
    }

    let cmd = format!("docker {} {}", action, shell_quote(&container_id));
    let _ = exec_remote_cmd(&config, &cmd).await?;
    Ok(())
}

/// 4. Create a detached container. When a startup command is supplied it is
/// executed inside the container via `sh -c`, not interpreted by the remote SSH
/// shell.
#[tauri::command]
pub async fn create_remote_container(
    config: ConnectConfig,
    input: CreateContainerInput,
) -> Result<(), AppError> {
    if input.image.trim().is_empty() {
        return Err(AppError::new("errDockerEmptyImage"));
    }

    let name = input.name.filter(|name| !name.trim().is_empty());
    if let Some(name) = &name {
        if !is_valid_container_name(name) {
            return Err(AppError::new("errDockerBadContainerName"));
        }
    }

    let mut cmd = String::from("docker run -d");
    if let Some(name) = name {
        cmd.push_str(" --name ");
        cmd.push_str(&shell_quote(&name));
    }
    cmd.push(' ');
    cmd.push_str(&shell_quote(input.image.trim()));

    if let Some(command) = input.command.filter(|command| !command.trim().is_empty()) {
        cmd.push_str(" sh -c ");
        cmd.push_str(&shell_quote(command.trim()));
    }

    let _ = exec_remote_cmd(&config, &cmd).await?;
    Ok(())
}

/// 5. Docker cannot modify a container's image or command in place. Renaming
/// is the supported edit operation without recreating the container.
#[tauri::command]
pub async fn rename_remote_container(
    config: ConnectConfig,
    container_id: String,
    name: String,
) -> Result<(), AppError> {
    if !is_valid_container_name(&container_id) || !is_valid_container_name(&name) {
        return Err(AppError::new("errDockerBadContainerId"));
    }

    let cmd = format!(
        "docker rename {} {}",
        shell_quote(&container_id),
        shell_quote(&name)
    );
    let _ = exec_remote_cmd(&config, &cmd).await?;
    Ok(())
}

/// 7. Fetch container logs via `docker logs`. Returns the raw log output as a
/// string. When `tail` is `None` all lines are returned; otherwise the last N
/// lines. `timestamps` prepends an ISO-8601 timestamp to each line.
#[tauri::command]
pub async fn get_remote_container_logs(
    config: ConnectConfig,
    container_id: String,
    tail: Option<u32>,
    timestamps: bool,
) -> Result<String, AppError> {
    if !is_valid_container_name(&container_id) {
        return Err(AppError::new("errDockerBadContainerId"));
    }

    // docker logs writes to both stdout and stderr, but exec_remote_cmd only
    // returns stdout. Redirect stderr to stdout so we capture everything.
    let mut cmd = String::from("{ docker logs");
    if let Some(n) = tail {
        cmd.push_str(&format!(" --tail {n}"));
    }
    if timestamps {
        cmd.push_str(" --timestamps");
    }
    cmd.push(' ');
    cmd.push_str(&shell_quote(&container_id));
    cmd.push_str(" ; } 2>&1");

    let output = exec_remote_cmd(&config, &cmd).await?;
    Ok(output)
}

/// 6. Remove a container (optionally force). Uses `docker rm` or `docker rm -f`.
#[tauri::command]
pub async fn remove_remote_container(
    config: ConnectConfig,
    container_id: String,
    force: bool,
) -> Result<(), AppError> {
    if !is_valid_container_name(&container_id) {
        return Err(AppError::new("errDockerBadContainerId"));
    }

    let flag = if force { " -f" } else { "" };
    let cmd = format!("docker rm{} {}", flag, shell_quote(&container_id));
    let _ = exec_remote_cmd(&config, &cmd).await?;
    Ok(())
}
