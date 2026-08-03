import { invoke } from '@tauri-apps/api/core'
import type { SshConnectConfig } from './ssh'

export interface RemoteService {
  name: string
  load: string
  active: string
  sub: string
  description: string
}

export function listRemoteServices(config: SshConnectConfig): Promise<RemoteService[]> {
  return invoke<RemoteService[]>('list_remote_services', { config })
}

export function controlRemoteService(
  config: SshConnectConfig,
  service: string,
  action: 'start' | 'stop' | 'restart',
): Promise<void> {
  return invoke<void>('control_remote_service', { config, service, action })
}
