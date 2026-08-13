import { invoke } from '@tauri-apps/api/core'

export function listSerialPorts(): Promise<string[]> {
  return invoke<string[]>('list_serial_ports')
}
