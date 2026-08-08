import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Columns2, FolderTree, GripHorizontal, Loader2, PanelBottomClose, PanelBottomOpen, Plus, X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { sshConnect, sshDisconnect, type SshConnectConfig } from '@/lib/ssh'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { TerminalView } from './TerminalView'

interface TerminalWindow {
  id: string
  sessionId: string
  title: string
  closable: boolean
}

interface TerminalWorkspaceProps {
  initialSessionId: string
  sshConfig: SshConnectConfig
  sftpReady: boolean
  fileBrowser: (terminalSessionId: string) => ReactNode
  active?: boolean
}

export function TerminalWorkspace({ initialSessionId, sshConfig, sftpReady, fileBrowser, active = true }: TerminalWorkspaceProps) {
  const { t } = useI18n()
  const initialWindow = {
    id: `terminal-${initialSessionId}`,
    sessionId: initialSessionId,
    title: t('terminalWindow', { number: 1 }),
    closable: false,
  }
  const [windows, setWindows] = useState<TerminalWindow[]>([initialWindow])
  const [activeWindowId, setActiveWindowId] = useState<string>(initialWindow.id)
  const [paneIds, setPaneIds] = useState<string[]>([initialWindow.id])
  const [filePanelOpen, setFilePanelOpen] = useState(true)
  const [panelHeight, setPanelHeight] = useState(38)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renamingWindowId, setRenamingWindowId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const resizingRef = useRef(false)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const extraSessionsRef = useRef<string[]>([])
  const [historyBySession] = useState(() => new Map<string, Uint8Array[]>())

  const historyFor = (sessionId: string) => {
    const history = historyBySession.get(sessionId)
    if (history) return history
    const next: Uint8Array[] = []
    historyBySession.set(sessionId, next)
    return next
  }

  useEffect(() => {
    return () => {
      for (const sessionId of extraSessionsRef.current) void sshDisconnect(sessionId)
      extraSessionsRef.current = []
    }
  }, [])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!resizingRef.current) return
      const workspace = workspaceRef.current
      if (!workspace) return
      const rect = workspace.getBoundingClientRect()
      const nextHeight = ((rect.bottom - event.clientY) / rect.height) * 100
      setPanelHeight(Math.min(70, Math.max(24, nextHeight)))
    }
    const stopResizing = () => {
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopResizing)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [])

  const startResizing = () => {
    resizingRef.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const openWindow = async () => {
    if (opening) return
    setOpening(true)
    setError(null)
    try {
      const sessionId = await sshConnect(sshConfig)
      extraSessionsRef.current.push(sessionId)
      const nextNumber = windows.length + 1
      const nextWindow = {
        id: `terminal-${sessionId}`,
        sessionId,
        title: t('terminalWindow', { number: nextNumber }),
        closable: true,
      }
      setWindows((current) => [...current, nextWindow])
      setActiveWindowId(nextWindow.id)
    } catch {
      setError(t('terminalWindowOpenFailed'))
    } finally {
      setOpening(false)
    }
  }

  const closeWindow = (windowId: string) => {
    const target = windows.find((item) => item.id === windowId)
    if (!target || !target.closable) return
    void sshDisconnect(target.sessionId)
    extraSessionsRef.current = extraSessionsRef.current.filter((id) => id !== target.sessionId)
    setPaneIds((current) => current.filter((id) => id !== windowId))
    setWindows((current) => {
      const remaining = current.filter((item) => item.id !== windowId)
      if (activeWindowId === windowId) setActiveWindowId(remaining[remaining.length - 1]?.id ?? null)
      return remaining
    })
  }

  const selectWindow = (windowId: string) => {
    setPaneIds((current) => current.includes(windowId) ? current : current.length === 2 ? [current[0], windowId] : [windowId])
    setActiveWindowId(windowId)
  }

  const splitWindowRight = (windowId: string) => {
    setPaneIds((current) => {
      if (current.length === 2 || current[0] === windowId) return current
      return [current[0], windowId]
    })
    setActiveWindowId(windowId)
  }

  const closeSplit = () => {
    setPaneIds((current) => current.slice(0, 1))
  }

  const startRenaming = (window: TerminalWindow) => {
    setRenamingWindowId(window.id)
    setRenameValue(window.title)
  }

  const finishRenaming = () => {
    if (!renamingWindowId) return
    const title = renameValue.trim()
    if (title) {
      setWindows((current) => current.map((item) => item.id === renamingWindowId ? { ...item, title } : item))
    }
    setRenamingWindowId(null)
  }

  const activeWindow = windows.find((item) => item.id === activeWindowId) ?? windows[0]

  return (
    <div ref={workspaceRef} className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0b0d10]">
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-muted/30 px-2">
        <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
          {windows.map((item) => (
            <ContextMenu key={item.id}>
              <ContextMenuTrigger
                render={
                  <button
                    type="button"
                    draggable
                    className={`group flex min-w-32 max-w-52 items-center gap-2 border-b-2 px-3 text-xs transition-colors ${
                      item.id === activeWindowId ? 'border-primary bg-background text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    onClick={() => selectWindow(item.id)}
                    onDoubleClick={() => startRenaming(item)}
                    onDragStart={(event) => {
                      if (!event.dataTransfer) return
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', item.id)
                    }}
                    title={t('renameTerminalWindowHint')}
                  />
                }
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                {renamingWindowId === item.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    aria-label={t('renameTerminalWindow')}
                    className="min-w-0 flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-xs outline-none"
                    onChange={(event) => setRenameValue(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onBlur={finishRenaming}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') finishRenaming()
                      if (event.key === 'Escape') setRenamingWindowId(null)
                    }}
                  />
                ) : (
                  <span className="truncate">{item.title}</span>
                )}
                {item.closable && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-auto rounded p-0.5 opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeWindow(item.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') closeWindow(item.id)
                    }}
                    aria-label={t('closeTerminalWindow')}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => startRenaming(item)}>{t('renameTerminalWindow')}</ContextMenuItem>
                <ContextMenuItem onClick={() => splitWindowRight(item.id)} disabled={paneIds.length === 2 || paneIds[0] === item.id}>
                  <Columns2 className="h-4 w-4" />
                  {t('splitTerminalRight')}
                </ContextMenuItem>
                {paneIds.includes(item.id) && paneIds.length === 2 && (
                  <ContextMenuItem onClick={closeSplit}>{t('closeTerminalSplit')}</ContextMenuItem>
                )}
                {item.closable && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onClick={() => closeWindow(item.id)}>{t('closeTerminalWindow')}</ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          ))}
          <Button variant="ghost" size="icon-xs" className="my-1 ml-1 shrink-0" title={t('newTerminalWindow')} aria-label={t('newTerminalWindow')} onClick={() => void openWindow()} disabled={opening}>
            {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <section
        className="relative flex min-h-0 min-w-0 flex-1"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const windowId = event.dataTransfer.getData('text/plain')
          if (windowId) splitWindowRight(windowId)
        }}
      >
        {windows.map((item) => {
          const paneIndex = paneIds.indexOf(item.id)
          if (paneIndex === -1) {
            return (
              <div key={item.id} className="absolute inset-0 invisible pointer-events-none">
                <TerminalView
                  sessionId={item.sessionId}
                  active={false}
                  history={historyFor(item.sessionId)}
                  onOutput={(bytes) => {
                    const history = historyFor(item.sessionId)
                    history.push(bytes.slice())
                    if (history.length > 10_000) history.splice(0, history.length - 10_000)
                  }}
                />
              </div>
            )
          }
          return (
            <div key={item.id} className={`relative min-w-0 flex-1 ${paneIndex > 0 ? 'border-l border-border' : ''}`} onClick={() => setActiveWindowId(item.id)}>
              {paneIds.length === 2 && (
                <div className="flex h-7 items-center gap-2 border-b border-border/60 bg-muted/20 px-3 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="truncate">{item.title}</span>
                  <button type="button" className="ml-auto rounded p-0.5 hover:bg-muted hover:text-foreground" onClick={(event) => { event.stopPropagation(); closeSplit() }} aria-label={t('closeTerminalSplit')}><X className="h-3 w-3" /></button>
                </div>
              )}
              <TerminalView sessionId={item.sessionId} active={active && item.id === activeWindow?.id} />
            </div>
          )
        })}
        {error && <div className="absolute bottom-3 left-3 z-10 rounded-md bg-destructive px-3 py-2 text-xs text-destructive-foreground">{error}</div>}
      </section>

      {filePanelOpen ? (
        <aside className="relative flex min-h-0 w-full shrink-0 flex-col border-t border-border bg-background shadow-[0_-10px_30px_rgba(0,0,0,0.12)]" style={{ height: `${panelHeight}%` }}>
          <button type="button" aria-label={t('resizeFilePanel')} className="absolute -top-1.5 left-0 z-10 flex h-3 w-full cursor-row-resize items-center justify-center text-muted-foreground/60 hover:text-foreground" onPointerDown={startResizing}>
            <GripHorizontal className="h-3 w-8 rounded bg-background" />
          </button>
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><FolderTree className="h-4 w-4" /></div>
            <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{t('files')}</h2><p className="text-[11px] text-muted-foreground">{t('filePanelHint')}</p></div>
            <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0" title={t('closeFilePanel')} aria-label={t('closeFilePanel')} onClick={() => setFilePanelOpen(false)}><PanelBottomClose className="h-4 w-4" /></Button>
          </header>
          {sftpReady && activeWindow ? <div className="min-h-0 flex-1">{fileBrowser(activeWindow.sessionId)}</div> : <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('establishingSftp')}</div>}
        </aside>
      ) : (
        <Button variant="outline" size="sm" className="absolute bottom-4 right-4 z-10 bg-background/95 shadow-lg backdrop-blur" onClick={() => setFilePanelOpen(true)}><PanelBottomOpen className="h-4 w-4" />{t('showFiles')}</Button>
      )}
    </div>
  )
}
