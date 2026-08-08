import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderTree, Loader2, PanelBottomClose, PanelBottomOpen, GripHorizontal } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { TerminalView } from './TerminalView'

interface TerminalWorkspaceProps {
  sessionId: string
  sftpReady: boolean
  fileBrowser: ReactNode
  active?: boolean
}

export function TerminalWorkspace({ sessionId, sftpReady, fileBrowser, active = true }: TerminalWorkspaceProps) {
  const { t } = useI18n()
  const [filePanelOpen, setFilePanelOpen] = useState(true)
  const [panelHeight, setPanelHeight] = useState(38)
  const resizingRef = useRef(false)
  const workspaceRef = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={workspaceRef} className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0b0d10]">
      <section className="min-h-0 min-w-0 flex-1">
        <TerminalView sessionId={sessionId} active={active} />
      </section>

      {filePanelOpen ? (
        <aside
          className="relative flex min-h-0 w-full shrink-0 flex-col border-t border-border bg-background shadow-[0_-10px_30px_rgba(0,0,0,0.12)]"
          style={{ height: `${panelHeight}%` }}
        >
          <button
            type="button"
            aria-label={t('resizeFilePanel')}
            className="absolute -top-1.5 left-0 z-10 flex h-3 w-full cursor-row-resize items-center justify-center text-muted-foreground/60 hover:text-foreground"
            onPointerDown={startResizing}
          >
            <GripHorizontal className="h-3 w-8 rounded bg-background" />
          </button>
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FolderTree className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{t('files')}</h2>
                <p className="text-[11px] text-muted-foreground">{t('filePanelHint')}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto shrink-0"
              title={t('closeFilePanel')}
              aria-label={t('closeFilePanel')}
              onClick={() => setFilePanelOpen(false)}
            >
              <PanelBottomClose className="h-4 w-4" />
            </Button>
          </header>
          {sftpReady ? (
            <div className="min-h-0 flex-1">{fileBrowser}</div>
          ) : (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('establishingSftp')}
            </div>
          )}
        </aside>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-4 right-4 z-10 bg-background/95 shadow-lg backdrop-blur"
          onClick={() => setFilePanelOpen(true)}
        >
          <PanelBottomOpen className="h-4 w-4" />
          {t('showFiles')}
        </Button>
      )}
    </div>
  )
}
