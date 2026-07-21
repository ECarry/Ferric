import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderTree, Loader2, Pencil, Plug, Power, TerminalSquare } from 'lucide-react'
import type { ConnectionStatus, Server } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  onSshClosed,
  sshConnect,
  sshDisconnect,
  type SshConnectConfig,
} from '@/lib/ssh'
import { sftpConnect, sftpDisconnect } from '@/lib/sftp'
import { FileBrowser } from './FileBrowser'
import { TerminalView } from './TerminalView'

interface MainPanelProps {
  server?: Server
  onEdit: () => void
}

const statusMeta: Record<ConnectionStatus, { label: string; color: string }> = {
  disconnected: { label: '未连接', color: 'bg-muted-foreground' },
  connecting: { label: '连接中...', color: 'bg-yellow-500' },
  connected: { label: '已连接', color: 'bg-green-500' },
  error: { label: '连接失败', color: 'bg-destructive' },
}

export function MainPanel({ server, onEdit }: MainPanelProps) {
  const [tab, setTab] = useState('terminal')
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sftpId, setSftpId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<string | null>(null)
  const sftpRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    if (sessionRef.current) void sshDisconnect(sessionRef.current)
    if (sftpRef.current) void sftpDisconnect(sftpRef.current)
    sessionRef.current = null
    sftpRef.current = null
    setSessionId(null)
    setSftpId(null)
    setStatus('disconnected')
    setError(null)
  }, [])

  // Disconnect only when this panel unmounts (server closed / deleted).
  // Switching servers no longer tears down the connection because each
  // server gets its own persistent MainPanel instance.
  useEffect(() => {
    return () => {
      if (sessionRef.current) void sshDisconnect(sessionRef.current)
      if (sftpRef.current) void sftpDisconnect(sftpRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect backend-initiated disconnects (shell exit, network drop).
  useEffect(() => {
    if (!sessionId) return
    let unlisten: (() => void) | undefined
    onSshClosed(sessionId, () => {
      sessionRef.current = null
      setSessionId(null)
      setStatus('disconnected')
    }).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  }, [sessionId])

  const connect = useCallback(async () => {
    if (!server) return
    setStatus('connecting')
    setError(null)
    const config: SshConnectConfig = {
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      password: server.password,
      keyPath: server.keyPath,
      cols: 80,
      rows: 24,
    }
    try {
      const id = await sshConnect(config)
      sessionRef.current = id
      setSessionId(id)
      setStatus('connected')
      // Open a separate SFTP session (best-effort; failure only disables SFTP).
      sftpConnect({
        host: server.host,
        port: server.port,
        username: server.username,
        authType: server.authType,
        password: server.password,
        keyPath: server.keyPath,
      })
        .then((sid) => {
          sftpRef.current = sid
          setSftpId(sid)
        })
        .catch((e) => console.error('SFTP 连接失败', e))
    } catch (e) {
      setStatus('error')
      setError(String(e))
    }
  }, [server])

  if (!server) return <WelcomeScreen />

  const connected = status === 'connected' && sessionId
  const meta = statusMeta[status]

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h1 className="truncate text-base font-semibold">{server.name}</h1>
            <Button variant="ghost" size="icon-xs" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {server.username}@{server.host}:{server.port}
          </div>
        </div>

        <div className="ml-2 flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
          <span className={cn('h-2 w-2 rounded-full', meta.color)} />
          {meta.label}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {connected ? (
            <Button variant="outline" size="sm" onClick={reset}>
              <Power className="h-4 w-4" />
              断开
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={connect}
              disabled={status === 'connecting'}
            >
              <Plug className="h-4 w-4" />
              连接
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      {!connected ? (
        <DisconnectedState
          status={status}
          error={error}
          onConnect={connect}
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
          <div className="border-b border-border px-3 py-2">
            <TabsList variant="line">
              <TabsTrigger value="terminal">
                <TerminalSquare className="h-4 w-4" />
                终端
              </TabsTrigger>
              <TabsTrigger value="sftp">
                <FolderTree className="h-4 w-4" />
                文件 (SFTP)
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="terminal" keepMounted className="min-h-0 data-[hidden]:hidden">
            <TerminalView sessionId={sessionId} />
          </TabsContent>
          <TabsContent value="sftp" className="min-h-0">
            {sftpId ? (
              <FileBrowser sessionId={sftpId} />
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在建立 SFTP 会话...
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function DisconnectedState({
  status,
  error,
  onConnect,
}: {
  status: ConnectionStatus
  error: string | null
  onConnect: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Plug className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          {status === 'error' ? '连接失败' : '尚未建立连接'}
        </p>
        {error ? (
          <p className="mt-1 max-w-md font-mono text-xs text-destructive">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground/70">点击下方按钮连接到服务器</p>
        )}
      </div>
      <Button onClick={onConnect} disabled={status === 'connecting'}>
        {status === 'connecting' ? '连接中...' : '立即连接'}
      </Button>
    </div>
  )
}

function WelcomeScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted">
        <TerminalSquare className="h-9 w-9 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">欢迎使用 Ferric SSH</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          从左侧选择一台服务器开始连接,或点击「添加服务器」创建新的连接配置。
        </p>
      </div>
    </div>
  )
}
