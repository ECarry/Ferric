import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Activity, Container, FileText, FolderTree, Loader2, Pencil, Plug, Power, ServerCog, TerminalSquare, Zap } from 'lucide-react'
import type { ConnectionStatus, Server } from '@/types'
import { cn } from '@/lib/utils'
import { formatAppError, isAppError } from '@/lib/error'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  onSshClosed,
  sshConnect,
  sshDisconnect,
  type SshConnectConfig,
} from '@/lib/ssh'
import { sftpConnect, sftpDisconnect } from '@/lib/sftp'
import { TerminalView } from './TerminalView'

const FileBrowser = lazy(() => import('./FileBrowser').then((module) => ({ default: module.FileBrowser })))
const DockerView = lazy(() => import('./docker/DockerView').then((module) => ({ default: module.DockerView })))
const PortForwardView = lazy(() => import('./PortForwardView').then((module) => ({ default: module.PortForwardView })))
const PerformanceView = lazy(() => import('./PerformanceView').then((module) => ({ default: module.PerformanceView })))
const ServicesView = lazy(() => import('./ServicesView').then((module) => ({ default: module.ServicesView })))
const LogsView = lazy(() => import('./LogsView').then((module) => ({ default: module.LogsView })))

interface MainPanelProps {
  server?: Server
  onEdit: () => void
  onStatusChange?: (id: string, status: ConnectionStatus) => void
  active?: boolean
}

const statusColor: Record<ConnectionStatus, string> = {
  disconnected: 'bg-muted-foreground', connecting: 'bg-yellow-500', connected: 'bg-green-500', error: 'bg-destructive',
}

export function MainPanel({ server, onEdit, onStatusChange, active = true }: MainPanelProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState('terminal')
  const [mountedTabs, setMountedTabs] = useState(() => new Set(['terminal']))
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sftpId, setSftpId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionPassword, setSessionPassword] = useState<string | null>(null)
  const [passwordPrompt, setPasswordPrompt] = useState(false)
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
      password: server.password ?? sessionPassword ?? undefined,
      keyPath: server.keyPath,
      keyPassphrase: server.keyPassphrase,
      cols: 80,
      rows: 24,
    }
  }, [server, sessionPassword])

  const reset = useCallback(() => {
    if (sessionRef.current) void sshDisconnect(sessionRef.current)
    if (sftpRef.current) void sftpDisconnect(sftpRef.current)
    sessionRef.current = null
    sftpRef.current = null
    setSessionId(null)
    setSftpId(null)
    setStatus('disconnected')
    setError(null)
    setSessionPassword(null)
    setPasswordPrompt(false)
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
    let disposed = false
    let unlisten: (() => void) | undefined
    onSshClosed(sessionId, () => {
      sessionRef.current = null
      setSessionId(null)
      setStatus('disconnected')
    }).then((fn) => {
      if (disposed) {
        fn()
      } else {
        unlisten = fn
      }
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [sessionId])

  const connect = useCallback(async (passwordOverride?: string) => {
    if (!sshConfig) return
    const config = passwordOverride === undefined
      ? sshConfig
      : { ...sshConfig, password: passwordOverride }
    if (passwordOverride !== undefined) setSessionPassword(passwordOverride)
    setStatus('connecting')
    setError(null)
    try {
      const id = await sshConnect(config)
      sessionRef.current = id
      setSessionId(id)
      setStatus('connected')
      setPasswordPrompt(false)
      // Open a separate SFTP session (best-effort; failure only disables SFTP).
      sftpConnect(config)
        .then((sid) => {
          sftpRef.current = sid
          setSftpId(sid)
        })
        .catch((e) => console.error('SFTP 连接失败', e))
    } catch (e) {
      setStatus('error')
      setError(formatAppError(e, t))
      if (isAppError(e) && e.code === 'errSshNoPassword') {
        setPasswordPrompt(true)
      }
    }
  }, [sshConfig, t])

  if (!server) return <WelcomeScreen />

  const connected = status === 'connected' && sessionId
  const passwordRequired = server.authType === 'password' && (!server.password && !sessionPassword || passwordPrompt)
  const meta = { label: t(status === 'error' ? 'connectionFailed' : status), color: statusColor[status] }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h1 className="truncate text-base font-semibold">{server.name}</h1>
            <Button variant="ghost" size="icon-xs" aria-label={t('editServer')} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {server.username}@{server.host}:{server.port}
          </div>
        </div>

        <div className="ml-0 flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs sm:ml-2" role="status" aria-live="polite">
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
              onClick={() => void connect()}
              disabled={status === 'connecting'}
              aria-busy={status === 'connecting'}
            >
              {status === 'connecting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
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
          passwordRequired={passwordRequired}
          onConnect={connect}
        />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value)
            setMountedTabs((current) => new Set(current).add(value))
          }}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="overflow-x-auto border-b border-border px-3 py-2">
            <TabsList variant="line" className="min-w-max">
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
              <TabsTrigger value="services">
                <ServerCog className="h-4 w-4" />
                {t('services')}
              </TabsTrigger>
              <TabsTrigger value="logs">
                <FileText className="h-4 w-4" />
                {t('logs')}
              </TabsTrigger>
            </TabsList>
          </div>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loadingContainers')}
              </div>
            }
          >
          <TabsContent value="terminal" keepMounted className="min-h-0 data-[hidden]:hidden">
            <TerminalView sessionId={sessionId} active={active} />
          </TabsContent>
          {mountedTabs.has('sftp') && (
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
          )}
          {mountedTabs.has('docker') && (
            <TabsContent value="docker" className="min-h-0">
              {sshConfig && <DockerView sshConfig={sshConfig} />}
            </TabsContent>
          )}
          {mountedTabs.has('forward') && (
            <TabsContent value="forward" className="min-h-0">
              {sshConfig && <PortForwardView sshConfig={sshConfig} />}
            </TabsContent>
          )}
          {mountedTabs.has('performance') && (
            <TabsContent value="performance" className="min-h-0">
              {sshConfig && <PerformanceView sshConfig={sshConfig} active={tab === 'performance'} />}
            </TabsContent>
          )}
          {mountedTabs.has('services') && (
            <TabsContent value="services" className="min-h-0">
              {sshConfig && <ServicesView sshConfig={sshConfig} />}
            </TabsContent>
          )}
          {mountedTabs.has('logs') && (
            <TabsContent value="logs" className="min-h-0">
              {sshConfig && <LogsView sshConfig={sshConfig} />}
            </TabsContent>
          )}
          </Suspense>
        </Tabs>
      )}
    </div>
  )
}

function DisconnectedState({
  status,
  error,
  passwordRequired,
  onConnect,
}: {
  status: ConnectionStatus
  error: string | null
  passwordRequired: boolean
  onConnect: (password?: string) => void
}) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password) return
    onConnect(password)
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Plug className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          {status === 'error' ? t('connectionFailed') : t('notConnected')}
        </p>
        {error && (
          <p className="mt-1 max-w-md break-words font-mono text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      {passwordRequired ? (
        <form onSubmit={submitPassword} className="w-full max-w-sm space-y-3 text-left">
          <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
            <p className="text-muted-foreground">$ {t('passwordPrompt')}</p>
            <p className="mt-1 text-muted-foreground/70">{t('passwordPromptHint')}</p>
          </div>
          <Input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('passwordPromptPlaceholder')}
            aria-label={t('password')}
            disabled={status === 'connecting'}
          />
          <Button type="submit" className="w-full" disabled={!password || status === 'connecting'}>
            {status === 'connecting' ? t('connecting') : t('connectNow')}
          </Button>
        </form>
      ) : (
        <>
          {!error && <p className="text-xs text-muted-foreground/70">{t('connectPrompt')}</p>}
          <Button onClick={() => onConnect()} disabled={status === 'connecting'}>
            {status === 'connecting' ? t('connecting') : t('connectNow')}
          </Button>
        </>
      )}
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
