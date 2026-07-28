import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { RemoteFile } from '@/types'
import type { SshConnectConfig } from './ssh'

export type SftpConnectConfig = SshConnectConfig

export interface TransferProgress {
  /** SFTP session id the progress belongs to. */
  id: string
  transferred: number
  /** Total bytes, or 0 when unknown. */
  total: number
}

/** Subscribe to download progress events. Remember to call the returned unlisten. */
export function onDownloadProgress(
  cb: (progress: TransferProgress) => void,
): Promise<UnlistenFn> {
  return listen<TransferProgress>('sftp:download-progress', (e) => cb(e.payload))
}

/** Subscribe to upload progress events. Remember to call the returned unlisten. */
export function onUploadProgress(
  cb: (progress: TransferProgress) => void,
): Promise<UnlistenFn> {
  return listen<TransferProgress>('sftp:upload-progress', (e) => cb(e.payload))
}

/** Open an SFTP session over its own SSH connection. Returns the session id. */
export function sftpConnect(config: SftpConnectConfig): Promise<string> {
  return invoke<string>('sftp_connect', { config })
}

/** Resolve the remote home directory (canonicalized "."). */
export function sftpHome(id: string): Promise<string> {
  return invoke<string>('sftp_home', { id })
}

/** List the entries of a remote directory (dirs first, then alphabetical). */
export function sftpList(id: string, path: string): Promise<RemoteFile[]> {
  return invoke<RemoteFile[]>('sftp_list', { id, path })
}

/** Download a remote file to a local path. */
export function sftpDownload(
  id: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  return invoke('sftp_download', { id, remotePath, localPath })
}

/**
 * Recursively download a remote directory into `localParentDir`. The remote
 * folder is recreated as a subdirectory named after its basename.
 */
export function sftpDownloadDir(
  id: string,
  remotePath: string,
  localParentDir: string,
): Promise<void> {
  return invoke('sftp_download_dir', {
    id,
    remotePath,
    localPath: localParentDir,
  })
}

/** Upload a local file to a remote path. */
export function sftpUpload(
  id: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return invoke('sftp_upload', { id, localPath, remotePath })
}

/** Cancel an in-flight upload/download for the given session. */
export function sftpCancel(id: string): Promise<void> {
  return invoke('sftp_cancel', { id })
}

/** Create a remote directory. */
export function sftpMkdir(id: string, path: string): Promise<void> {
  return invoke('sftp_mkdir', { id, path })
}

/** Remove a remote file or empty directory. */
export function sftpRemove(id: string, path: string, isDir: boolean): Promise<void> {
  return invoke('sftp_remove', { id, path, isDir })
}

/** Rename / move a remote entry. */
export function sftpRename(id: string, from: string, to: string): Promise<void> {
  return invoke('sftp_rename', { id, from, to })
}

/** Close an SFTP session. */
export function sftpDisconnect(id: string): Promise<void> {
  return invoke('sftp_disconnect', { id })
}
