import { invoke } from '@tauri-apps/api/core'
import type { SshConnectConfig } from './ssh'

export interface RemoteLog {
  id: string
  label: string
  path?: string
  kind: 'file' | 'journal'
}

export function listRemoteLogs(config: SshConnectConfig): Promise<RemoteLog[]> {
  return invoke<RemoteLog[]>('list_remote_logs', { config })
}

export function readRemoteLog(
  config: SshConnectConfig,
  logId: string,
  lines: number,
): Promise<string> {
  return invoke<string>('read_remote_log', { config, logId, lines })
}
