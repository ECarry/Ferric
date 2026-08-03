import { useMemo, useState } from 'react'
import { useDockerInfo, useDockerMutations } from '@/hooks/useDocker'
import { AlertCircle, Loader2, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, ScrollText, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ContainerFormModal } from '@/components/docker/ContainerFormModal'
import { ContainerLogsDialog } from '@/components/docker/ContainerLogsDialog'
import { cn } from '@/lib/utils'
import { formatAppError } from '@/lib/error'
import { useI18n } from '@/i18n'
import {
  type DockerContainer,
} from '@/lib/docker'
import type { SshConnectConfig } from '@/lib/ssh'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  sshConfig: SshConnectConfig
}

export function DockerView({ sshConfig }: Props) {
  const { t } = useI18n()
  const [formTarget, setFormTarget] = useState<DockerContainer | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<DockerContainer | null>(null)
  const [logsTarget, setLogsTarget] = useState<DockerContainer | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all')
  const dockerQuery = useDockerInfo(sshConfig)
  const { control, create, rename, remove } = useDockerMutations(sshConfig)
  const info = dockerQuery.data?.[0] ?? null
  const containers = useMemo(() => dockerQuery.data?.[1] ?? [], [dockerQuery.data])
  const loading = dockerQuery.isLoading || dockerQuery.isFetching
  const error = actionError ?? (dockerQuery.error ? formatAppError(dockerQuery.error, t) : null)
  const filteredContainers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return containers.filter((container) => {
      const running = container.status.toLowerCase().includes('up')
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'running' ? running : !running)
      const matchesQuery = !normalizedQuery || [container.names, container.image, container.id, container.status]
        .some((value) => value.toLowerCase().includes(normalizedQuery))
      return matchesStatus && matchesQuery
    })
  }, [containers, query, statusFilter])

  const onControl = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActingId(id)
    setActionError(null)
    try {
      await control.mutateAsync({ containerId: id, action })
    } catch (err) {
      setActionError(formatAppError(err, t))
    } finally {
      setActingId(null)
    }
  }

  const onSaveContainer = async (input: { name?: string; image: string; command?: string }) => {
    setActionError(null)
    try {
      if (formTarget) {
        await rename.mutateAsync({ containerId: formTarget.id, name: input.name ?? '' })
      } else {
        await create.mutateAsync(input)
      }
    } catch (err) {
      const message = formatAppError(err, t)
      setActionError(message)
      throw new Error(message, { cause: err })
    }
  }

  const onConfirmDelete = async () => {
    if (!deleteTarget) return
    setActingId(deleteTarget.id)
    setActionError(null)
    try {
      const force = deleteTarget.status.toLowerCase().includes('up')
      await remove.mutateAsync({ containerId: deleteTarget.id, force })
    } catch (err) {
      setActionError(formatAppError(err, t))
    } finally {
      setActingId(null)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        {info ? (
          <div className="text-sm text-muted-foreground">
            Docker <span className="font-medium text-foreground">{info.version}</span>
            {' · '}
            {info.os}/{info.arch}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t('remoteDocker')}</div>
        )}
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <Button size="sm" onClick={() => setFormTarget(null)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('createContainer')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void dockerQuery.refetch()}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            {t('refresh')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('dockerSearch')}
            aria-label={t('dockerSearch')}
            className="h-8 pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
          <SelectTrigger className="h-8 w-32" aria-label={t('status')}>
            <SelectValue>{(value) => value === 'running' ? t('running') : value === 'stopped' ? t('stopped') : t('allStatuses')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allStatuses')}</SelectItem>
            <SelectItem value="running">{t('running')}</SelectItem>
            <SelectItem value="stopped">{t('stopped')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Container table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-medium">ID</th>
              <th className="px-4 py-2 text-left font-medium">{t('name')}</th>
              <th className="px-4 py-2 text-left font-medium">{t('image')}</th>
              <th className="px-4 py-2 text-left font-medium">{t('status')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {containers.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <p className="text-sm text-muted-foreground">{t('noContainers')}</p>
                  <Button variant="link" size="sm" onClick={() => setFormTarget(null)}>
                    {t('createContainer')}
                  </Button>
                </td>
              </tr>
            )}
            {filteredContainers.map((c) => {
              const running = c.status.toLowerCase().includes('up')
              const busy = actingId === c.id
              return (
                <tr
                  key={c.id}
                  className="border-b border-border/50 transition-colors hover:bg-muted"
                >
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {c.id.slice(0, 12)}
                  </td>
                  <td className="px-4 py-2">{c.names}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.image}</td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs',
                        running
                          ? 'bg-green-500/10 text-green-600'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {running ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={t('stop')}
                          aria-label={`${t('stop')} ${c.names}`}
                          disabled={busy}
                          onClick={() => void onControl(c.id, 'stop')}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={t('start')}
                          aria-label={`${t('start')} ${c.names}`}
                          disabled={busy}
                          onClick={() => void onControl(c.id, 'start')}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t('restart')}
                        aria-label={`${t('restart')} ${c.names}`}
                        disabled={busy}
                        onClick={() => void onControl(c.id, 'restart')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t('viewLogs')}
                        aria-label={`${t('viewLogs')} ${c.names}`}
                        disabled={busy}
                        onClick={() => setLogsTarget(c)}
                      >
                        <ScrollText className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t('editContainer')}
                        aria-label={`${t('editContainer')} ${c.names}`}
                        disabled={busy}
                        onClick={() => setFormTarget(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t('deleteContainer')}
                        aria-label={`${t('deleteContainer')} ${c.names}`}
                        disabled={busy}
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {loading && containers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  {t('loadingContainers')}
                </td>
              </tr>
            )}

            {containers.length > 0 && filteredContainers.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {t('noMatchingContainers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {formTarget !== undefined && (
        <ContainerFormModal
          initial={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSave={onSaveContainer}
        />
      )}

      {logsTarget && (
        <ContainerLogsDialog
          container={logsTarget}
          sshConfig={sshConfig}
          onClose={() => setLogsTarget(null)}
        />
      )}

      {deleteTarget && (
        <Dialog open onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteContainer')}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t('confirmDeleteContainer', { name: deleteTarget.names })}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                {t('cancel')}
              </Button>
              <Button variant="destructive" onClick={() => void onConfirmDelete()}>
                {t('confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

