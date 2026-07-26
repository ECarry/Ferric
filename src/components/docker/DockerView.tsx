import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2, Pencil, Play, Plus, RefreshCw, RotateCcw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContainerFormModal } from '@/components/docker/ContainerFormModal'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import {
  controlRemoteContainer,
  createRemoteContainer,
  getRemoteDockerVersion,
  listRemoteContainers,
  renameRemoteContainer,
  type DockerContainer,
  type DockerInfo,
} from '@/lib/docker'
import type { SshConnectConfig } from '@/lib/ssh'

interface Props {
  sshConfig: SshConnectConfig
}

export function DockerView({ sshConfig }: Props) {
  const { t } = useI18n()
  const [info, setInfo] = useState<DockerInfo | null>(null)
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formTarget, setFormTarget] = useState<DockerContainer | null | undefined>(undefined)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [verInfo, containerList] = await Promise.all([
        getRemoteDockerVersion(sshConfig),
        listRemoteContainers(sshConfig, true),
      ])
      setInfo(verInfo)
      setContainers(containerList)
    } catch (err) {
      setError(formatError(err, t('dockerUnavailable')))
    } finally {
      setLoading(false)
    }
  }, [sshConfig])

  const onControl = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActingId(id)
    setError(null)
    try {
      await controlRemoteContainer(sshConfig, id, action)
      await loadData()
    } catch (err) {
      setError(formatError(err, t('dockerUnavailable')))
    } finally {
      setActingId(null)
    }
  }

  const onSaveContainer = async (input: { name?: string; image: string; command?: string }) => {
    setError(null)
    try {
      if (formTarget) {
        await renameRemoteContainer(sshConfig, formTarget.id, input.name ?? '')
      } else {
        await createRemoteContainer(sshConfig, input)
      }
      await loadData()
    } catch (err) {
      const message = formatError(err, t('dockerUnavailable'))
      setError(message)
      throw new Error(message, { cause: err })
    }
  }

  useEffect(() => {
    // Initial data load on mount / sshConfig change is the intended behavior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        {info ? (
          <div className="text-sm text-muted-foreground">
            Docker <span className="font-medium text-foreground">{info.version}</span>
            {' · '}
            {info.os}/{info.arch}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t('remoteDocker')}</div>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setFormTarget(null)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('createContainer')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadData()}
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

      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
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
            {containers.map((c) => {
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
                        disabled={busy}
                        onClick={() => void onControl(c.id, 'restart')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t('editContainer')}
                        disabled={busy}
                        onClick={() => setFormTarget(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
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
            {!loading && containers.length === 0 && !error && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  {t('noContainers')}
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
    </div>
  )
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : fallback
}
