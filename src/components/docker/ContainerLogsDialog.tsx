import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatAppError } from '@/lib/error'
import { useI18n } from '@/i18n'
import { getRemoteContainerLogs, type DockerContainer } from '@/lib/docker'
import type { SshConnectConfig } from '@/lib/ssh'

interface ContainerLogsDialogProps {
  container: DockerContainer
  sshConfig: SshConnectConfig
  onClose: () => void
}

const TAIL_PRESETS = [50, 200, 500, 1000]

export function ContainerLogsDialog({
  container,
  sshConfig,
  onClose,
}: ContainerLogsDialogProps) {
  const { t } = useI18n()
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tail, setTail] = useState(200)
  const [timestamps, setTimestamps] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const fetchLogs = useCallback(async () => {
    setError(null)
    try {
      const output = await getRemoteContainerLogs(
        sshConfig,
        container.id,
        tail,
        timestamps,
      )
      setLogs(output || t('noLogs'))
    } catch (e) {
      setError(formatAppError(e, t))
    } finally {
      setLoading(false)
    }
  }, [sshConfig, container.id, tail, timestamps, t])

  useEffect(() => {
    void fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => void fetchLogs(), 3000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [autoRefresh, fetchLogs])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{t('containerLogs')}</span>
            <span className="font-mono text-sm font-normal text-muted-foreground">
              {container.names}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t('tailLines')}</span>
            {TAIL_PRESETS.map((n) => (
              <Button
                key={n}
                variant={tail === n ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setTail(n)}
              >
                {n}
              </Button>
            ))}
            <Input
              type="number"
              min={1}
              value={tail}
              onChange={(e) => setTail(Math.max(1, Number(e.target.value) || 200))}
              className="h-7 w-20 text-xs"
            />
          </div>

          <Button
            variant={timestamps ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setTimestamps((v) => !v)}
          >
            <Clock className="mr-1 h-3.5 w-3.5" />
            {t('timestamps')}
          </Button>

          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {t('autoRefresh')}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={loading}
            onClick={() => void fetchLogs()}
          >
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            {t('refresh')}
          </Button>
        </div>

        {/* Log content */}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-[#0b0d11] p-3">
          {error ? (
            <p className="font-mono text-xs text-destructive">{error}</p>
          ) : (
            <pre
              ref={logRef}
              className={cn(
                'whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-[#e6e9f0]',
                loading && 'opacity-50',
              )}
            >
              {logs}
            </pre>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
