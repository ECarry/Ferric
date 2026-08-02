import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Container, FolderTree, Loader2, Pencil, Plug, Power, TerminalSquare, Zap } from 'lucide-react'
import type { ConnectionStatus, Server } from '@/types'
import { cn } from '@/lib/utils'
import { formatAppError } from '@/lib/error'
import { useI18n } from '@/i18n'
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
import { DockerView } from './docker/DockerView'
import { PortForwardView } from './PortForwardView'
import { PerformanceView } from './PerformanceView'

interface MainPanelProps {
  server?: Server
  onEdit: () => void
  onStatusChange?: (id: string, status: ConnectionStatus) => void
}

const statusColor: Record<ConnectionStatus, string> = {
  disconnected: 'bg-muted-foreground', connecting: 'bg-yellow-500', connected: 'bg-green-500', error: 'bg-destructive',
}

export function MainPanel({ server, onEdit, onStatusChange }: MainPanelProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState('terminal')
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sftpId, setSftpId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<string | null>(null)
  const sftpRef = useRef<string | null>(null)
  const serverIdRef = useRef<string | undefined>(server?.id)
  const statusChangeRef = useRef(onStatusChange)

  const sshConfig = useMemo<SshConnectConfig | null>(() => {
    if (!server) return null
    return {
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      password: server.password,
      keyPath: server.keyPath,
      keyPassphrase: server.keyPassphrase,
      cols: 80,
      rows: 24,
    }
  }, [server])

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
  }, [])

  useEffect(() => {
    serverIdRef.current = server?.id
    statusChangeRef.current = onStatusChange
  }, [server?.id, onStatusChange])

  // Report connection status upward so the sidebar can show a live indicator.
  useEffect(() => {
    if (server) onStatusChange?.(server.id, status)
  }, [server, status, onStatusChange])

  // Notify parent this server is disconnected when the panel unmounts.
  useEffect(() => {
    return () => {
      const serverId = serverIdRef.current
      if (serverId) statusChangeRef.current?.(serverId, 'disconnected')
    }
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
    if (!sshConfig) return
    setStatus('connecting')
    setError(null)
    try {
      const id = await sshConnect(sshConfig)
      sessionRef.current = id
      setSessionId(id)
      setStatus('connected')
      // Open a separate SFTP session (best-effort; failure only disables SFTP).
      sftpConnect(sshConfig)
        .then((sid) => {
          sftpRef.current = sid
          setSftpId(sid)
        })
        .catch((e) => console.error('SFTP 连接失败', e))
    } catch (e) {
      setStatus('error')
      setError(formatAppError(e, t))
    }
  }, [sshConfig, t])

  if (!server) return <WelcomeScreen />

  const connected = status === 'connected' && sessionId
  const meta = { label: t(status === 'error' ? 'connectionFailed' : status), color: statusColor[status] }

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
              {t('disconnect')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={connect}
              disabled={status === 'connecting'}
            >
              <Plug className="h-4 w-4" />
              {t('connect')}
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
                {t('terminal')}
              </TabsTrigger>
              <TabsTrigger value="sftp">
                <FolderTree className="h-4 w-4" />
                {t('files')}
              </TabsTrigger>
              <TabsTrigger value="docker">
                <Container className="h-4 w-4" />
                {t('containers')}
              </TabsTrigger>
              <TabsTrigger value="forward">
                <Zap className="h-4 w-4" />
                {t('portForward')}
              </TabsTrigger>
              <TabsTrigger value="performance">
                <Activity className="h-4 w-4" />
                {t('performance')}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="terminal" keepMounted className="min-h-0 data-[hidden]:hidden">
            <TerminalView sessionId={sessionId} />
          </TabsContent>
          <TabsContent value="sftp" className="min-h-0">
            {sftpId ? (
              <FileBrowser key={sftpId} sessionId={sftpId} />
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('establishingSftp')}
              </div>
            )}
          </TabsContent>
          <TabsContent value="docker" className="min-h-0">
            {sshConfig && <DockerView sshConfig={sshConfig} />}
          </TabsContent>
          <TabsContent value="forward" className="min-h-0">
            {sshConfig && <PortForwardView sshConfig={sshConfig} />}
          </TabsContent>
          <TabsContent value="performance" className="min-h-0">
            {sshConfig && <PerformanceView sshConfig={sshConfig} />}
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
  const { t } = useI18n()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Plug className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          {status === 'error' ? t('connectionFailed') : t('notConnected')}
        </p>
        {error ? (
          <p className="mt-1 max-w-md font-mono text-xs text-destructive">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground/70">{t('connectPrompt')}</p>
        )}
      </div>
      <Button onClick={onConnect} disabled={status === 'connecting'}>
        {status === 'connecting' ? t('connecting') : t('connectNow')}
      </Button>
    </div>
  )
}

function WelcomeScreen() {
  const { t } = useI18n()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted">
        <TerminalSquare className="h-9 w-9 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{t('welcome')}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {t('welcomeHint')}
        </p>
      </div>
    </div>
  )
}
