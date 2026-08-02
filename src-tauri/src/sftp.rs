use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Local};
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Semaphore;

use crate::error::AppError;
use crate::ssh::{connect_and_auth, Client, ConnectConfig};

const SFTP_IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// A live SFTP session plus the SSH handle that keeps its connection open.
struct SftpConn {
    _session: Handle<Client>,
    sftp: Arc<SftpSession>,
}

/// Tracks open SFTP sessions, keyed by session id.
pub struct SftpManager {
    sessions: Mutex<HashMap<String, SftpConn>>,
    /// Per-session cancellation flags for in-flight transfers.
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    transfer_slots: Arc<Semaphore>,
}

impl Default for SftpManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
            transfer_slots: Arc::new(Semaphore::new(3)),
        }
    }
}

/// Reset and return the cancellation flag for a session, called at the start
/// of every transfer so a stale cancel doesn't abort the next one.
fn begin_transfer(state: &State<'_, SftpManager>, id: &str) -> Result<Arc<AtomicBool>, AppError> {
    let mut cancels = state.cancels.lock().map_err(|e| AppError::new("errUnknown").detail(e))?;
    let flag = cancels
        .entry(id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone();
    flag.store(false, Ordering::SeqCst);
    Ok(flag)
}

/// A directory entry returned to the frontend (mirrors the `RemoteFile` type).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    name: String,
    /// "file" | "dir"
    #[serde(rename = "type")]
    kind: String,
    size: u64,
    modified: String,
    permissions: String,
}

/// Pull an `Arc<SftpSession>` out of the manager for a given id.
fn session_for(state: &State<'_, SftpManager>, id: &str) -> Result<Arc<SftpSession>, AppError> {
    let sessions = state.sessions.lock().map_err(|e| AppError::new("errUnknown").detail(e))?;
    sessions
        .get(id)
        .map(|c| c.sftp.clone())
        .ok_or_else(|| AppError::new("errSftpNoSession"))
}

/// Format a unix mtime as a local "YYYY-MM-DD HH:MM" string.
fn format_mtime(mtime: Option<u32>) -> String {
    match mtime {
        Some(secs) => DateTime::<Local>::from(
            std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs as u64),
        )
        .format("%Y-%m-%d %H:%M")
        .to_string(),
        None => String::new(),
    }
}

/// Build an `ls -l`-style permission string, e.g. `drwxr-xr-x`.
fn format_permissions(kind: &FileType, perms: Option<u32>) -> String {
    let prefix = match kind {
        FileType::Dir => 'd',
        FileType::Symlink => 'l',
        FileType::File => '-',
        FileType::Other => '?',
    };
    match perms {
        Some(mode) => format!(
            "{prefix}{}",
            russh_sftp::protocol::FilePermissions::from(mode)
        ),
        None => format!("{prefix}?????????"),
    }
}

/// Open an SFTP session over its own SSH connection. Returns the session id.
#[tauri::command]
pub async fn sftp_connect(
    state: State<'_, SftpManager>,
    config: ConnectConfig,
) -> Result<String, AppError> {
    let session = connect_and_auth(&config).await.map_err(AppError::from)?;

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| AppError::new("errSftpChannel").detail(e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| AppError::new("errSftpSubsystem").detail(e))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| AppError::new("errSftpInit").detail(e))?;

    let id = uuid::Uuid::new_v4().to_string();
    state.sessions.lock().map_err(|e| AppError::new("errUnknown").detail(e))?.insert(
        id.clone(),
        SftpConn {
            _session: session,
            sftp: Arc::new(sftp),
        },
    );

    Ok(id)
}

/// Resolve the absolute path for a (possibly relative) path — used for the home dir.
#[tauri::command]
pub async fn sftp_home(state: State<'_, SftpManager>, id: String) -> Result<String, AppError> {
    let sftp = session_for(&state, &id)?;
    sftp.canonicalize(".").await.map_err(|e| AppError::new("errSftpCanonicalize").detail(e))
}

/// List the contents of a remote directory.
#[tauri::command]
pub async fn sftp_list(
    state: State<'_, SftpManager>,
    id: String,
    path: String,
) -> Result<Vec<RemoteFile>, AppError> {
    let sftp = session_for(&state, &id)?;
    let entries = sftp.read_dir(path).await.map_err(|e| AppError::new("errSftpReadDir").detail(e))?;

    let mut files: Vec<RemoteFile> = entries
        .map(|entry| {
            let meta = entry.metadata();
            let kind = entry.file_type();
            RemoteFile {
                name: entry.file_name(),
                kind: if kind.is_dir() { "dir" } else { "file" }.to_string(),
                size: meta.size.unwrap_or(0),
                modified: format_mtime(meta.mtime),
                permissions: format_permissions(&kind, meta.permissions),
            }
        })
        .collect();

    // Directories first, then alphabetical.
    files.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
        ("dir", "file") => std::cmp::Ordering::Less,
        ("file", "dir") => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(files)
}

/// Progress payload emitted during a transfer, keyed by SFTP session id.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    id: String,
    transferred: u64,
    total: u64,
}

/// Download a remote file to a local path, emitting `sftp:download-progress`
/// events (throttled) so the frontend can render a progress bar.
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, SftpManager>,
    id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), AppError> {
    let sftp = session_for(&state, &id)?;
    let cancel = begin_transfer(&state, &id)?;
    let _slot = state
        .transfer_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| AppError::new("errSftpTransferUnavailable"))?;
    // Best-effort total size for the progress bar; 0 means unknown.
    let total = sftp
        .metadata(&remote_path)
        .await
        .ok()
        .and_then(|m| m.size)
        .unwrap_or(0);
    let mut remote = sftp.open(&remote_path).await.map_err(|e| AppError::new("errSftpOpen").detail(e))?;
    let mut local = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?;

    let emit = |transferred: u64| {
        let _ = app.emit(
            "sftp:download-progress",
            TransferProgress {
                id: id.clone(),
                transferred,
                total,
            },
        );
    };

    let mut buf = vec![0u8; 64 * 1024];
    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut cancelled = false;
    emit(0);
    loop {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let n = tokio::time::timeout(SFTP_IO_TIMEOUT, remote.read(&mut buf))
            .await
            .map_err(|_| AppError::new("errSftpTransferTimeout"))?
            .map_err(|e| AppError::new("errSftpRead").detail(e))?;
        if n == 0 {
            break;
        }
        tokio::time::timeout(SFTP_IO_TIMEOUT, local.write_all(&buf[..n]))
            .await
            .map_err(|_| AppError::new("errSftpTransferTimeout"))?
            .map_err(|e| AppError::new("errSftpWrite").detail(e))?;
        transferred += n as u64;
        // Throttle to ~10 events/sec to avoid flooding the IPC channel.
        if last_emit.elapsed().as_millis() >= 100 {
            last_emit = std::time::Instant::now();
            emit(transferred);
        }
    }
    if cancelled {
        // Discard the partially written file.
        drop(local);
        let _ = tokio::fs::remove_file(&local_path).await;
        return Ok(());
    }
    local.flush().await.map_err(|e| AppError::new("errSftpFlush").detail(e))?;
    emit(transferred);
    Ok(())
}

/// Recursively download a remote directory into `local_path` (the local parent
/// directory). The remote folder is recreated as a subdirectory named after its
/// basename. Emits the same `sftp:download-progress` events as file downloads,
/// with `transferred`/`total` aggregated across every file in the tree.
#[tauri::command]
pub async fn sftp_download_dir(
    app: AppHandle,
    state: State<'_, SftpManager>,
    id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), AppError> {
    use std::path::PathBuf;

    let sftp = session_for(&state, &id)?;
    let cancel = begin_transfer(&state, &id)?;
    let _slot = state
        .transfer_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| AppError::new("errSftpTransferUnavailable"))?;

    // Recreate the remote folder as a subdirectory of the chosen local parent.
    let folder_name = remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("download");
    let root = PathBuf::from(&local_path).join(folder_name);

    // Walk the tree iteratively: collect dirs to create, files to download,
    // and the total byte count for the progress bar.
    let mut dirs: Vec<PathBuf> = vec![root.clone()];
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    let mut total: u64 = 0;
    let mut stack: Vec<(String, PathBuf)> = vec![(remote_path.clone(), root.clone())];

    while let Some((rdir, ldir)) = stack.pop() {
        let entries = sftp.read_dir(rdir.clone()).await.map_err(|e| AppError::new("errSftpReadDir").detail(e))?;
        for entry in entries {
            let name = entry.file_name();
            let rpath = if rdir.ends_with('/') {
                format!("{rdir}{name}")
            } else {
                format!("{rdir}/{name}")
            };
            let lpath = ldir.join(&name);
            if entry.file_type().is_dir() {
                dirs.push(lpath.clone());
                stack.push((rpath, lpath));
            } else {
                total += entry.metadata().size.unwrap_or(0);
                files.push((rpath, lpath));
            }
        }
    }

    // Create the directory skeleton first (preserves empty directories too).
    for dir in &dirs {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?;
    }

    let emit = |transferred: u64| {
        let _ = app.emit(
            "sftp:download-progress",
            TransferProgress {
                id: id.clone(),
                transferred,
                total,
            },
        );
    };

    let mut buf = vec![0u8; 64 * 1024];
    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut cancelled = false;
    emit(0);
    'files: for (rpath, lpath) in files {
        let mut remote = sftp.open(rpath).await.map_err(|e| AppError::new("errSftpOpen").detail(e))?;
        let mut local = tokio::fs::File::create(&lpath)
            .await
            .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?;
        loop {
            if cancel.load(Ordering::SeqCst) {
                cancelled = true;
                break 'files;
            }
            let n = tokio::time::timeout(SFTP_IO_TIMEOUT, remote.read(&mut buf))
            .await
            .map_err(|_| AppError::new("errSftpTransferTimeout"))?
            .map_err(|e| AppError::new("errSftpRead").detail(e))?;
            if n == 0 {
                break;
            }
            local
                .write_all(&buf[..n])
                .await
                .map_err(|e| AppError::new("errSftpWrite").detail(e))?;
            transferred += n as u64;
            if last_emit.elapsed().as_millis() >= 100 {
                last_emit = std::time::Instant::now();
                emit(transferred);
            }
        }
        local.flush().await.map_err(|e| AppError::new("errSftpFlush").detail(e))?;
    }
    if cancelled {
        // Remove the partially downloaded folder tree.
        let _ = tokio::fs::remove_dir_all(&root).await;
        return Ok(());
    }
    emit(transferred);
    Ok(())
}

/// Upload a local file to a remote path, emitting `sftp:upload-progress`
/// events (throttled) so the frontend can render a progress bar.
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, SftpManager>,
    id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), AppError> {
    let sftp = session_for(&state, &id)?;
    let cancel = begin_transfer(&state, &id)?;
    let _slot = state
        .transfer_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| AppError::new("errSftpTransferUnavailable"))?;
    let total = tokio::fs::metadata(&local_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let mut local = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?;
    let mut remote = sftp.create(&remote_path).await.map_err(|e| AppError::new("errSftpCreate").detail(e))?;

    let emit = |transferred: u64| {
        let _ = app.emit(
            "sftp:upload-progress",
            TransferProgress {
                id: id.clone(),
                transferred,
                total,
            },
        );
    };

    let mut buf = vec![0u8; 64 * 1024];
    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut cancelled = false;
    emit(0);
    loop {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let n = tokio::time::timeout(SFTP_IO_TIMEOUT, local.read(&mut buf))
            .await
            .map_err(|_| AppError::new("errSftpTransferTimeout"))?
            .map_err(|e| AppError::new("errSftpRead").detail(e))?;
        if n == 0 {
            break;
        }
        tokio::time::timeout(SFTP_IO_TIMEOUT, remote.write_all(&buf[..n]))
            .await
            .map_err(|_| AppError::new("errSftpTransferTimeout"))?
            .map_err(|e| AppError::new("errSftpWrite").detail(e))?;
        transferred += n as u64;
        if last_emit.elapsed().as_millis() >= 100 {
            last_emit = std::time::Instant::now();
            emit(transferred);
        }
    }
    if cancelled {
        // Close the stream and remove the partially uploaded remote file.
        let _ = remote.shutdown().await;
        let _ = sftp.remove_file(&remote_path).await;
        return Ok(());
    }
    remote.flush().await.map_err(|e| AppError::new("errSftpFlush").detail(e))?;
    remote.shutdown().await.map_err(|e| AppError::new("errSftpFlush").detail(e))?;
    emit(transferred);
    Ok(())
}

/// Recursively upload a local directory to a remote path. The local folder
/// is recreated as a subdirectory of `remote_path` named after its basename.
/// Emits `sftp:upload-progress` events with aggregated `transferred`/`total`
/// across every file in the tree.
#[tauri::command]
pub async fn sftp_upload_dir(
    app: AppHandle,
    state: State<'_, SftpManager>,
    id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), AppError> {
    use std::path::PathBuf;

    let sftp = session_for(&state, &id)?;
    let cancel = begin_transfer(&state, &id)?;
    let _slot = state
        .transfer_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| AppError::new("errSftpTransferUnavailable"))?;

    // Recreate the local folder as a subdirectory of the chosen remote parent.
    let folder_name = std::path::Path::new(&local_path)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("upload")
        .to_string();
    let root = format!("{}/{}", remote_path.trim_end_matches('/'), folder_name);

    // Walk the local tree iteratively: collect dirs to create, files to upload,
    // and the total byte count for the progress bar.
    let mut dirs: Vec<String> = vec![root.clone()];
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut total: u64 = 0;
    let mut stack: Vec<(PathBuf, String)> = vec![(PathBuf::from(&local_path), root.clone())];

    while let Some((ldir, rdir)) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&ldir)
            .await
            .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?
        {
            let lpath = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let rpath = format!("{}/{}", rdir.trim_end_matches('/'), name);
            let file_type = entry
                .file_type()
                .await
                .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?;
            if file_type.is_dir() {
                dirs.push(rpath.clone());
                stack.push((lpath, rpath));
            } else {
                total += entry
                    .metadata()
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0);
                files.push((lpath, rpath));
            }
        }
    }

    // Create the remote directory skeleton first (preserves empty directories too).
    for dir in &dirs {
        // Best-effort: ignore "already exists" errors.
        let _ = sftp.create_dir(dir).await;
    }

    let emit = |transferred: u64| {
        let _ = app.emit(
            "sftp:upload-progress",
            TransferProgress {
                id: id.clone(),
                transferred,
                total,
            },
        );
    };

    let mut buf = vec![0u8; 64 * 1024];
    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut cancelled = false;
    emit(0);
    'files: for (lpath, rpath) in files {
        let mut local = tokio::fs::File::open(&lpath)
            .await
            .map_err(|e| AppError::new("errSftpLocalFile").detail(e))?;
        let mut remote = sftp
            .create(&rpath)
            .await
            .map_err(|e| AppError::new("errSftpCreate").detail(e))?;
        loop {
            if cancel.load(Ordering::SeqCst) {
                cancelled = true;
                break 'files;
            }
            let n = local
                .read(&mut buf)
                .await
                .map_err(|e| AppError::new("errSftpRead").detail(e))?;
            if n == 0 {
                break;
            }
            remote
                .write_all(&buf[..n])
                .await
                .map_err(|e| AppError::new("errSftpWrite").detail(e))?;
            transferred += n as u64;
            if last_emit.elapsed().as_millis() >= 100 {
                last_emit = std::time::Instant::now();
                emit(transferred);
            }
        }
        remote
            .flush()
            .await
            .map_err(|e| AppError::new("errSftpFlush").detail(e))?;
        remote
            .shutdown()
            .await
            .map_err(|e| AppError::new("errSftpFlush").detail(e))?;
    }
    if cancelled {
        // Best-effort cleanup of the partially uploaded remote directory tree.
        let _ = sftp.remove_dir(&root).await;
        return Ok(());
    }
    emit(transferred);
    Ok(())
}

/// Cancel an in-flight transfer (upload/download) for the given session.
#[tauri::command]
pub fn sftp_cancel(state: State<'_, SftpManager>, id: String) -> Result<(), AppError> {
    let cancels = state.cancels.lock().map_err(|e| AppError::new("errUnknown").detail(e))?;
    if let Some(flag) = cancels.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Create a directory.
#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, SftpManager>,
    id: String,
    path: String,
) -> Result<(), AppError> {
    let sftp = session_for(&state, &id)?;
    sftp.create_dir(path).await.map_err(|e| AppError::new("errSftpMkdir").detail(e))
}

/// Remove a file or (empty) directory.
#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, SftpManager>,
    id: String,
    path: String,
    is_dir: bool,
) -> Result<(), AppError> {
    let sftp = session_for(&state, &id)?;
    if is_dir {
        sftp.remove_dir(path).await.map_err(|e| AppError::new("errSftpRemove").detail(e))
    } else {
        sftp.remove_file(path).await.map_err(|e| AppError::new("errSftpRemove").detail(e))
    }
}

/// Rename / move a remote entry.
#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, SftpManager>,
    id: String,
    from: String,
    to: String,
) -> Result<(), AppError> {
    let sftp = session_for(&state, &id)?;
    sftp.rename(from, to).await.map_err(|e| AppError::new("errSftpRename").detail(e))
}

/// Close an SFTP session and drop its SSH connection.
#[tauri::command]
pub async fn sftp_disconnect(state: State<'_, SftpManager>, id: String) -> Result<(), AppError> {
    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.remove(&id);
    }
    let conn = state.sessions.lock().map_err(|e| AppError::new("errUnknown").detail(e))?.remove(&id);
    if let Some(conn) = conn {
        let _ = conn.sftp.close().await;
    }
    Ok(())
}
