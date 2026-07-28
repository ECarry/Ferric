use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

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

fn config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::new("errConfigDir").detail(e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::new("errConfigDirCreate").detail(e))?;
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
fn write_secret(account: &str, secret: &str) -> Result<(), AppError> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .and_then(|entry| entry.set_password(secret))
        .map_err(|e| AppError::new("errKeychain").detail(e))
}

/// Remove a secret from the keychain (ignores "not found").
fn delete_secret(account: &str) {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, account) {
        let _ = entry.delete_credential();
    }
}

/// Load the persisted config, hydrating passwords from the keychain.
#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<Config, AppError> {
    let path = config_path(&app)?;
    let mut config: Config = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|e| AppError::new("errConfigRead").detail(e))?;
        serde_json::from_str(&raw).map_err(|e| AppError::new("errConfigParse").detail(e))?
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
pub fn save_config(app: AppHandle, config: Config) -> Result<(), AppError> {
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
        .map_err(|e| AppError::new("errConfigSerialize").detail(e))?;
    fs::write(&path, json)
        .map_err(|e| AppError::new("errConfigWrite").detail(e))?;
    Ok(())
}

/// Delete a server's stored password and passphrase from the keychain.
#[tauri::command]
pub fn delete_server_secret(server_id: String) -> Result<(), AppError> {
    delete_secret(&server_id);
    delete_secret(&passphrase_account(&server_id));
    Ok(())
}
