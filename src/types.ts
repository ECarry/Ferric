export type AuthType = 'password' | 'key'

export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  /** Only for UI mock — never store plaintext in a real app */
  password?: string
  keyPath?: string
  /** Optional passphrase protecting the private key. */
  keyPassphrase?: string
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
