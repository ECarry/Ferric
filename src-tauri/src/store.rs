use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Keychain service under which per-server passwords are stored.
const KEYCHAIN_SERVICE: &str = "com.ferric.app";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    /// "password" | "key"
    pub auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase: Option<String>,
    pub group_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_connected: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            servers: Vec::new(),
            groups: vec![
                Group {
                    id: "g-prod".into(),
                    name: "Production".into(),
                },
                Group {
                    id: "g-staging".into(),
                    name: "Staging".into(),
                },
                Group {
                    id: "g-personal".into(),
                    name: "Personal".into(),
                },
            ],
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录: {e}"))?;
    Ok(dir.join("config.json"))
}

/// Keychain account under which a server's private-key passphrase is stored.
fn passphrase_account(server_id: &str) -> String {
    format!("{server_id}:passphrase")
}

/// Read a stored secret (password or passphrase) from the OS keychain.
fn read_secret(account: &str) -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

/// Store a secret in the OS keychain.
fn write_secret(account: &str, secret: &str) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .and_then(|entry| entry.set_password(secret))
        .map_err(|e| format!("无法写入密钥链: {e}"))
}

/// Remove a secret from the keychain (ignores "not found").
fn delete_secret(account: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, account) {
        let _ = entry.delete_credential();
    }
}

/// Load the persisted config, hydrating passwords from the keychain.
#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<Config, String> {
    let path = config_path(&app)?;
    let mut config: Config = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {e}"))?;
        serde_json::from_str(&raw).map_err(|e| format!("解析配置失败: {e}"))?
    } else {
        Config::default()
    };

    for server in config.servers.iter_mut() {
        if server.auth_type == "password" {
            server.password = read_secret(&server.id);
        } else if server.auth_type == "key" {
            server.key_passphrase = read_secret(&passphrase_account(&server.id));
        }
    }

    Ok(config)
}

/// Persist the config to disk. Plaintext passwords are stripped from the
/// JSON file and stored in the OS keychain instead.
#[tauri::command]
pub fn save_config(app: AppHandle, config: Config) -> Result<(), String> {
    let path = config_path(&app)?;
    let mut to_write = config.clone();

    for server in to_write.servers.iter_mut() {
        match server.password.take() {
            Some(pw) if !pw.is_empty() => write_secret(&server.id, &pw)?,
            // Empty/absent password on save leaves any existing keychain entry
            // untouched so editing other fields doesn't wipe the secret.
            _ => {}
        }
        match server.key_passphrase.take() {
            Some(pp) if !pp.is_empty() => {
                write_secret(&passphrase_account(&server.id), &pp)?
            }
            _ => {}
        }
    }

    let json = serde_json::to_string_pretty(&to_write)
        .map_err(|e| format!("序列化配置失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入配置失败: {e}"))?;
    Ok(())
}

/// Delete a server's stored password and passphrase from the keychain.
#[tauri::command]
pub fn delete_server_secret(server_id: String) -> Result<(), String> {
    delete_secret(&server_id);
    delete_secret(&passphrase_account(&server_id));
    Ok(())
}
