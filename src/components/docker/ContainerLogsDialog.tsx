import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Loader2, RefreshCw, Search } from 'lucide-react'
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

const LOG_LEVELS = ['all', 'info', 'warn', 'error', 'debug'] as const
type LogLevel = (typeof LOG_LEVELS)[number]

const LEVEL_COLORS: Record<LogLevel | 'other', string> = {
  all: 'text-[#e6e9f0]',
  info: 'text-gray-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-blue-400',
  other: 'text-[#e6e9f0]',
}

function getLogLevel(line: string): LogLevel | 'other' {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('critical')) return 'error'
  if (lower.includes('warn')) return 'warn'
  if (lower.includes('info')) return 'info'
  if (lower.includes('debug')) return 'debug'
  return 'other'
}

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
  const [filter, setFilter] = useState('')
  const [level, setLevel] = useState<LogLevel>('all')
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
    const timer = window.setTimeout(() => void fetchLogs(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchLogs])

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => void fetchLogs(), 3000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [autoRefresh, fetchLogs])

  const displayLines = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return logs.split('\n').filter((line) => {
      if (level !== 'all' && getLogLevel(line) !== level) return false
      if (query && !line.toLowerCase().includes(query)) return false
      return true
    })
  }, [logs, filter, level])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="m-0 flex h-screen w-screen max-w-none sm:max-w-none md:max-w-none flex-col rounded-none p-5">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex w-full items-center gap-2">
            <span className="shrink-0">{t('containerLogs')}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-sm font-normal text-muted-foreground">
              {container.names}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('tailLines')}</span>
            {TAIL_PRESETS.map((n) => (
              <Button
                key={n}
                variant={tail === n ? 'default' : 'outline'}
                size="sm"
                className="h-8 px-3 text-sm"
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
              className="h-8 w-24 text-sm"
            />
          </div>

          <Button
            variant={timestamps ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-sm"
            onClick={() => setTimestamps((v) => !v)}
          >
            <Clock className="mr-1.5 h-4 w-4" />
            {t('timestamps')}
          </Button>

          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-sm"
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {t('autoRefresh')}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm"
            disabled={loading}
            onClick={() => void fetchLogs()}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            {t('refresh')}
          </Button>
        </div>

        {/* Log filter */}
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('filterLogs')}
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {LOG_LEVELS.map((l) => (
              <Button
                key={l}
                variant={level === l ? 'default' : 'outline'}
                size="sm"
                className="h-8 px-2 text-xs capitalize"
                onClick={() => setLevel(l)}
              >
                {l}
              </Button>
            ))}
          </div>
        </div>

        {/* Log content */}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-[#0b0d11] p-5">
          {error ? (
            <p className="font-mono text-sm text-destructive">{error}</p>
          ) : (
            <pre
              ref={logRef}
              className={cn(
                'whitespace-pre-wrap break-words font-mono text-sm leading-7',
                loading && 'opacity-50',
              )}
            >
              {displayLines.length === 0 ? (
                <span className="text-gray-400">{t('noMatchingLogs')}</span>
              ) : (
                displayLines.map((line, i) => (
                  <span
                    key={i}
                    className={cn('block', LEVEL_COLORS[getLogLevel(line)])}
                  >
                    {line || ' '}
                  </span>
                ))
              )}
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
