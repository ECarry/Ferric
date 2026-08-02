import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { RemoteFile } from '@/types'
import type { SshConnectConfig } from './ssh'

export type SftpConnectConfig = SshConnectConfig

export interface TransferProgress {
  transferId: string
  sessionId: string
  transferred: number
  /** Total bytes, or 0 when unknown. */
  total: number
}

export function createTransferId(): string {
  return crypto.randomUUID()
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
  transferId: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  return invoke('sftp_download', { id, transferId, remotePath, localPath })
}

/**
 * Recursively download a remote directory into `localParentDir`. The remote
 * folder is recreated as a subdirectory named after its basename.
 */
export function sftpDownloadDir(
  id: string,
  transferId: string,
  remotePath: string,
  localParentDir: string,
): Promise<void> {
  return invoke('sftp_download_dir', {
    id,
    transferId,
    remotePath,
    localPath: localParentDir,
  })
}

/** Upload a local file to a remote path. */
export function sftpUpload(
  id: string,
  transferId: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return invoke('sftp_upload', { id, transferId, localPath, remotePath })
}

/**
 * Recursively upload a local directory into `remotePath` (the remote parent
 * directory). The local folder is recreated as a subdirectory named after its
 * basename.
 */
export function sftpUploadDir(
  id: string,
  transferId: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return invoke('sftp_upload_dir', { id, transferId, localPath, remotePath })
}

/** Cancel one in-flight upload/download by its transfer ID. */
export function sftpCancel(transferId: string): Promise<void> {
  return invoke('sftp_cancel', { transferId })
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
