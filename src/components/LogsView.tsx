import { useMemo, useState } from 'react'
import { AlertCircle, FileText, Loader2, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatAppError } from '@/lib/error'
import { useI18n } from '@/i18n'
import { useRemoteLog, useRemoteLogs } from '@/hooks/useLogs'
import type { SshConnectConfig } from '@/lib/ssh'

interface LogsViewProps {
  sshConfig: SshConnectConfig
}

type LevelFilter = 'all' | 'error' | 'warning' | 'info'

const logLabelKeys: Record<string, string> = {
  syslog: 'systemLog',
  messages: 'systemMessages',
  auth: 'authenticationLog',
  secure: 'securityLog',
  kern: 'kernelLog',
  dmesg: 'kernelRingBuffer',
  journal: 'systemJournal',
}

function getLogLevel(line: string): Exclude<LevelFilter, 'all'> | 'other' {
  const value = line.toLowerCase()
  if (/\b(err|error|fatal|critical|crit|fail)\b/.test(value)) return 'error'
  if (/\b(warn|warning)\b/.test(value)) return 'warning'
  if (/\b(info|notice|started|accepted|success)\b/.test(value)) return 'info'
  return 'other'
}

function matchesLevel(line: string, level: LevelFilter) {
  return level === 'all' || getLogLevel(line) === level
}

const levelColors: Record<Exclude<LevelFilter, 'all'> | 'other', string> = {
  error: 'text-red-500',
  warning: 'text-yellow-500',
  info: 'text-sky-500',
  other: 'text-foreground',
}

export function LogsView({ sshConfig }: LogsViewProps) {
  const { t } = useI18n()
  const logsQuery = useRemoteLogs(sshConfig)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lines, setLines] = useState(500)
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>('all')
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data])
  const selectedLog = logs.find((log) => log.id === selectedId) ?? logs[0]
  const contentQuery = useRemoteLog(sshConfig, selectedLog?.id ?? null, lines)
  const content = contentQuery.data ?? ''
  const normalizedQuery = query.trim().toLowerCase()
  const visibleLines = useMemo(
    () => content.split('\n').filter((line) =>
      (!normalizedQuery || line.toLowerCase().includes(normalizedQuery)) && matchesLevel(line, level),
    ),
    [content, level, normalizedQuery],
  )
  const loading = logsQuery.isLoading || contentQuery.isLoading
  const error = logsQuery.error
    ? formatAppError(logsQuery.error, t)
    : contentQuery.error
      ? formatAppError(contentQuery.error, t)
      : null

  const refresh = () => {
    void logsQuery.refetch()
    if (selectedLog) void contentQuery.refetch()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>{t('logs')}</span>
        </div>
        <Select value={selectedLog?.id ?? ''} onValueChange={setSelectedId}>
          <SelectTrigger className="h-8 min-w-48 max-w-full sm:w-64" aria-label={t('logSource')}>
            <SelectValue placeholder={t('selectLog')} />
          </SelectTrigger>
          <SelectContent>
            {logs.map((log) => (
              <SelectItem key={log.id} value={log.id}>{t(logLabelKeys[log.id] ?? log.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-48">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchLogs')}
              aria-label={t('searchLogs')}
              className="h-8 pl-8"
            />
          </div>
          <Select value={level} onValueChange={(value) => setLevel(value as LevelFilter)}>
            <SelectTrigger className="h-8 w-28" aria-label={t('logLevel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allLevels')}</SelectItem>
              <SelectItem value="error">{t('errors')}</SelectItem>
              <SelectItem value="warning">{t('warnings')}</SelectItem>
              <SelectItem value="info">{t('info')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(lines)} onValueChange={(value) => setLines(Number(value))}>
            <SelectTrigger className="h-8 w-24" aria-label={t('logLines')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="1000">1000</SelectItem>
              <SelectItem value="5000">5000</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon-sm" onClick={refresh} disabled={loading} aria-label={t('refresh')} title={t('refresh')}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{selectedLog?.path ?? selectedLog?.label ?? t('noLogs')}</span>
          <span>{t('matchingLines', { count: visibleLines.length })}</span>
        </div>
        {loading && !content ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('loadingLogs')}
          </div>
        ) : !logs.length ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('noLogFiles')}</div>
        ) : !visibleLines.length ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('noMatchingLogs')}</div>
        ) : (
          <pre className="select-text flex-1 overflow-auto bg-muted/20 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
            {visibleLines.map((line, index) => (
              <span key={`${index}-${line}`} className={`block ${levelColors[getLogLevel(line)]}`}>
                {line || ' '}
              </span>
            ))}
          </pre>
        )}
      </div>
    </div>
  )
}
