import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface SshConnectConfig {
  protocol: 'ssh' | 'telnet' | 'serial'
  host: string
  port: number
  username: string
  baudRate?: number
  dataBits?: 5 | 6 | 7 | 8
  parity?: 'none' | 'odd' | 'even'
  stopBits?: 1 | 2
  authType: 'password' | 'key'
  password?: string
  keyPath?: string
  keyPassphrase?: string
  cols: number
  rows: number
}

interface SshDataPayload {
  id: string
  data: number[]
}

interface SshClosedPayload {
  id: string
}

/** Open an SSH connection with an interactive PTY. Returns the session id. */
export function sshConnect(config: SshConnectConfig): Promise<string> {
  return invoke<string>('ssh_connect', { config })
}

export function protocolConnect(config: SshConnectConfig): Promise<string> {
  return invoke<string>('protocol_connect', { config })
}

export function protocolSendInput(id: string, data: string): Promise<void> {
  return invoke('protocol_send_input', { id, data })
}

export function protocolDisconnect(id: string): Promise<void> {
  return invoke('protocol_disconnect', { id })
}

/** Send keystrokes / input bytes to the remote shell. */
export function sshSendInput(id: string, data: string): Promise<void> {
  return invoke('ssh_send_input', { id, data })
}

/** Inform the remote PTY of a new terminal size. */
export function sshResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke('ssh_resize', { id, cols, rows })
}

/** Close the SSH session. */
export function sshDisconnect(id: string): Promise<void> {
  return invoke('ssh_disconnect', { id })
}

/** Subscribe to shell output for a given session id. */
export async function onSshData(
  id: string,
  cb: (bytes: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<SshDataPayload>('ssh:data', (event) => {
    if (event.payload.id === id) {
      cb(new Uint8Array(event.payload.data))
    }
  })
}

/** Subscribe to the session-closed event for a given session id. */
export async function onSshClosed(
  id: string,
  cb: () => void,
): Promise<UnlistenFn> {
  return listen<SshClosedPayload>('ssh:closed', (event) => {
    if (event.payload.id === id) cb()
  })
}

// ── Port Forwarding ──────────────────────────────────────────────

export interface ForwardConfig {
  config: SshConnectConfig
  localPort: number
  remoteHost: string
  remotePort: number
}

export interface ForwardEvent {
  id: string
  event: 'started' | 'stopped' | 'connected' | 'disconnected' | 'error'
  message?: string
}

/** Start a local port-forward tunnel. Returns the tunnel id. */
export function sshForwardStart(config: ForwardConfig): Promise<string> {
  return invoke<string>('ssh_forward_start', { config })
}

/** Stop a port-forward tunnel by its id. */
export function sshForwardStop(id: string): Promise<void> {
  return invoke('ssh_forward_stop', { id })
}

/** Stop all active tunnels. */
export function sshForwardStopAll(): Promise<void> {
  return invoke('ssh_forward_stop_all')
}

/** List active tunnel ids. */
export function sshForwardList(): Promise<string[]> {
  return invoke<string[]>('ssh_forward_list')
}

/** Subscribe to port-forward events for a specific tunnel id. */
export async function onForwardEvent(
  id: string,
  cb: (event: ForwardEvent) => void,
): Promise<UnlistenFn> {
  return listen<ForwardEvent>('ssh:forward-event', (e) => {
    if (e.payload.id === id) cb(e.payload)
  })
}
