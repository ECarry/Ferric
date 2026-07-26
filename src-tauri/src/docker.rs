use russh::ChannelMsg;
use serde::{Deserialize, Serialize};

// 复用项目现有的 SSH 配置与连接认证
use crate::ssh::{connect_and_auth, ConnectConfig};

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
async fn exec_remote_cmd(config: &ConnectConfig, cmd: &str) -> Result<String, String> {
    let session = connect_and_auth(config)
        .await
        .map_err(|e| format!("SSH 连接失败: {}", e))?;

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("打开 SSH Channel 失败: {}", e))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("执行远程 Docker 命令失败: {}", e))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_status: Option<u32> = None;

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, ext } if ext == 1 => stderr.extend_from_slice(&data),
            ChannelMsg::ExitStatus {
                exit_status: status,
            } => exit_status = Some(status),
            _ => {}
        }
    }

    let stdout_str = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&stderr).trim().to_string();

    if matches!(exit_status, Some(status) if status != 0) {
        return Err(format!(
            "远程命令执行失败 (exit: {:?}): {} {}",
            exit_status, stdout_str, stderr_str
        ));
    }

    Ok(stdout_str)
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
    format!("'{}'", value.replace('\'', "'\\\"'\\\"'"))
}

/// 1. 获取远程 Docker 版本信息
#[tauri::command]
pub async fn get_remote_docker_version(config: ConnectConfig) -> Result<DockerInfo, String> {
    let cmd = "docker version --format '{{json .Server}}'";

    let raw_json = exec_remote_cmd(&config, cmd).await?;

    let parsed: DockerVersionRow = serde_json::from_str(raw_json.trim())
        .map_err(|e| format!("解析 Docker 版本 JSON 失败: {} (原始输出: {})", e, raw_json))?;

    Ok(DockerInfo {
        version: parsed.version.unwrap_or_else(|| "Unknown".to_string()),
        api_version: parsed.api_version.unwrap_or_else(|| "Unknown".to_string()),
        os: parsed.os.unwrap_or_else(|| "Unknown".to_string()),
        arch: parsed.arch.unwrap_or_else(|| "Unknown".to_string()),
    })
}

/// 2. 获取远程 Docker 容器列表
#[tauri::command]
pub async fn list_remote_containers(
    config: ConnectConfig,
    all: bool,
) -> Result<Vec<DockerContainer>, String> {
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
        let row: DockerPsRow = serde_json::from_str(line)
            .map_err(|e| format!("解析 Docker 容器 JSON 失败: {} (原始输出: {})", e, line))?;
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
) -> Result<(), String> {
    let valid_actions = ["start", "stop", "restart"];
    if !valid_actions.contains(&action.as_str()) {
        return Err("不支持的操作类型".to_string());
    }

    // This value is interpolated into a shell command, so permit only valid
    // Docker name / ID characters.
    if !is_valid_container_name(&container_id) {
        return Err("无效的容器 ID 或名称".to_string());
    }

    let cmd = format!("docker {} {}", action, container_id);
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
) -> Result<(), String> {
    if input.image.trim().is_empty() {
        return Err("镜像不能为空".to_string());
    }

    let name = input.name.filter(|name| !name.trim().is_empty());
    if let Some(name) = &name {
        if !is_valid_container_name(name) {
            return Err("无效的容器名称".to_string());
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
) -> Result<(), String> {
    if !is_valid_container_name(&container_id) || !is_valid_container_name(&name) {
        return Err("无效的容器 ID 或名称".to_string());
    }

    let cmd = format!(
        "docker rename {} {}",
        shell_quote(&container_id),
        shell_quote(&name)
    );
    let _ = exec_remote_cmd(&config, &cmd).await?;
    Ok(())
}
