use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Keychain service under which per-server passwords are stored.
const KEYCHAIN_SERVICE: &str = "com.ferric.app";

fn default_protocol() -> String {
    "ssh".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    #[serde(default = "default_protocol")]
    pub protocol: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub baud_rate: Option<u32>,
    #[serde(default)]
    pub data_bits: Option<u8>,
    #[serde(default)]
    pub parity: Option<String>,
    #[serde(default)]
    pub stop_bits: Option<u8>,
    pub username: String,
    /// "password" | "key"
    pub auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing)]
    pub has_password: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase: Option<String>,
    #[serde(default, skip_serializing)]
    pub has_key_passphrase: bool,
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
    fs::create_dir_all(&dir).map_err(|e| AppError::new("errConfigDirCreate").detail(e))?;
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

pub(crate) fn read_server_secret(server_id: &str, passphrase: bool) -> Option<String> {
    let account = if passphrase {
        passphrase_account(server_id)
    } else {
        server_id.to_string()
    };
    read_secret(&account)
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

fn restore_secrets(snapshots: &[(String, Option<String>)]) {
    for (account, value) in snapshots {
        match value {
            Some(secret) => {
                let _ = write_secret(account, secret);
            }
            None => delete_secret(account),
        }
    }
}

/// Load the persisted config, hydrating passwords from the keychain.
#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<Config, AppError> {
    let path = config_path(&app)?;
    let backup_path = path.with_extension("json.bak");
    let mut config: Config = if path.exists() {
        let raw =
            fs::read_to_string(&path).map_err(|e| AppError::new("errConfigRead").detail(e))?;
        match serde_json::from_str(&raw) {
            Ok(config) => config,
            Err(primary_error) if backup_path.exists() => {
                let backup = fs::read_to_string(&backup_path)
                    .map_err(|e| AppError::new("errConfigRead").detail(e))?;
                serde_json::from_str(&backup).map_err(|e| {
                    AppError::new("errConfigParse").detail(format!("{primary_error}; backup: {e}"))
                })?
            }
            Err(error) => return Err(AppError::new("errConfigParse").detail(error)),
        }
    } else if backup_path.exists() {
        let backup = fs::read_to_string(&backup_path)
            .map_err(|e| AppError::new("errConfigRead").detail(e))?;
        serde_json::from_str(&backup).map_err(|e| AppError::new("errConfigParse").detail(e))?
    } else {
        Config::default()
    };

    for server in config.servers.iter_mut() {
        server.password = None;
        server.key_passphrase = None;
        server.has_password = server.auth_type == "password" && read_secret(&server.id).is_some();
        server.has_key_passphrase =
            server.auth_type == "key" && read_secret(&passphrase_account(&server.id)).is_some();
    }

    Ok(config)
}

/// Persist the config to disk. Plaintext passwords are stripped from the
/// JSON file and stored in the OS keychain instead.
#[tauri::command]
pub fn save_config(app: AppHandle, config: Config) -> Result<(), AppError> {
    let path = config_path(&app)?;
    let mut to_write = config.clone();
    let mut snapshots = Vec::with_capacity(to_write.servers.len() * 2);
    for server in &to_write.servers {
        snapshots.push((server.id.clone(), read_secret(&server.id)));
        snapshots.push((
            passphrase_account(&server.id),
            read_secret(&passphrase_account(&server.id)),
        ));
    }

    for server in to_write.servers.iter_mut() {
        if server.auth_type == "password" {
            match server.password.take() {
                Some(pw) if !pw.is_empty() => {
                    if let Err(error) = write_secret(&server.id, &pw) {
                        restore_secrets(&snapshots);
                        return Err(error);
                    }
                }
                _ => {}
            }
            delete_secret(&passphrase_account(&server.id));
        } else if server.auth_type == "key" {
            match server.key_passphrase.take() {
                Some(pp) if !pp.is_empty() => {
                    if let Err(error) = write_secret(&passphrase_account(&server.id), &pp) {
                        restore_secrets(&snapshots);
                        return Err(error);
                    }
                }
                _ => {}
            }
            delete_secret(&server.id);
        } else {
            server.password = None;
            server.key_passphrase = None;
        }
    }

    let json = match serde_json::to_vec_pretty(&to_write) {
        Ok(json) => json,
        Err(error) => {
            restore_secrets(&snapshots);
            return Err(AppError::new("errConfigSerialize").detail(error));
        }
    };
    let temp_path = path.with_extension("json.tmp");
    let backup_path = path.with_extension("json.bak");

    if let Err(error) = fs::write(&temp_path, json) {
        restore_secrets(&snapshots);
        return Err(AppError::new("errConfigWrite").detail(error));
    }
    if path.exists() {
        let _ = fs::remove_file(&backup_path);
        if let Err(error) = fs::rename(&path, &backup_path) {
            let _ = fs::remove_file(&temp_path);
            restore_secrets(&snapshots);
            return Err(AppError::new("errConfigWrite").detail(error));
        }
    }
    if let Err(error) = fs::rename(&temp_path, &path) {
        if backup_path.exists() && !path.exists() {
            let _ = fs::rename(&backup_path, &path);
        }
        restore_secrets(&snapshots);
        return Err(AppError::new("errConfigWrite").detail(error));
    }
    Ok(())
}

/// Delete a server's stored password and passphrase from the keychain.
#[tauri::command]
pub fn delete_server_secret(server_id: String) -> Result<(), AppError> {
    delete_secret(&server_id);
    delete_secret(&passphrase_account(&server_id));
    Ok(())
}
