export type AuthType = 'password' | 'key'
export type ConnectionProtocol = 'ssh' | 'telnet' | 'serial'

export interface Server {
  id: string
  name: string
  protocol: ConnectionProtocol
  host: string
  port: number
  username: string
  baudRate?: number
  dataBits?: 5 | 6 | 7 | 8
  parity?: 'none' | 'odd' | 'even'
  stopBits?: 1 | 2
  authType: AuthType
  /** Only populated for a one-time password prompt; saved passwords stay in the OS keychain. */
  password?: string
  hasPassword?: boolean
  keyPath?: string
  /** Optional passphrase protecting the private key. */
  keyPassphrase?: string
  hasKeyPassphrase?: boolean
  groupId: string
  color?: string
  lastConnected?: string
}

export interface ServerGroup {
  id: string
  name: string
}

export interface RemoteFile {
  name: string
  type: 'file' | 'dir'
  size: number
  modified: string
  permissions: string
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
