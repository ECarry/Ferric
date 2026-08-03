import { useMemo, useState } from 'react'
import { AlertCircle, Loader2, Play, RefreshCw, RotateCcw, ServerCog, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { formatAppError } from '@/lib/error'
import { useRemoteServices, useServiceMutations } from '@/hooks/useServices'
import type { SshConnectConfig } from '@/lib/ssh'

interface ServicesViewProps {
  sshConfig: SshConnectConfig
}

export function ServicesView({ sshConfig }: ServicesViewProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [actingService, setActingService] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const servicesQuery = useRemoteServices(sshConfig)
  const { control } = useServiceMutations(sshConfig)
  const loading = servicesQuery.isLoading || servicesQuery.isFetching
  const error = actionError ?? (servicesQuery.error ? formatAppError(servicesQuery.error, t) : null)
  const services = useMemo(() => {
    const value = query.trim().toLowerCase()
    return (servicesQuery.data ?? []).filter((service) =>
      !value || `${service.name} ${service.description} ${service.active} ${service.sub}`.toLowerCase().includes(value),
    )
  }, [query, servicesQuery.data])

  const onControl = async (service: string, action: 'start' | 'stop' | 'restart') => {
    setActingService(service)
    setActionError(null)
    try {
      await control.mutateAsync({ service, action })
    } catch (e) {
      setActionError(formatAppError(e, t))
    } finally {
      setActingService(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ServerCog className="h-4 w-4" />
          <span>{t('services')}</span>
          {servicesQuery.data && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{servicesQuery.data.length}</span>}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchServices')}
            aria-label={t('searchServices')}
            className="h-8 min-w-0 flex-1 sm:w-56 sm:flex-none"
          />
          <Button variant="outline" size="sm" onClick={() => void servicesQuery.refetch()} disabled={loading} aria-busy={loading}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            {t('refresh')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-medium">{t('serviceName')}</th>
              <th className="px-4 py-2 text-left font-medium">{t('serviceStatus')}</th>
              <th className="px-4 py-2 text-left font-medium">{t('description')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && services.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{t('loadingServices')}</td></tr>
            )}
            {!loading && services.length === 0 && !error && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">{query ? t('noMatchingServices') : t('noServices')}</td></tr>
            )}
            {services.map((service) => {
              const busy = actingService === service.name
              const active = service.active === 'active'
              return (
                <tr key={service.name} className="border-b border-border/50 transition-colors hover:bg-muted/60">
                  <td className="px-4 py-2.5 font-mono text-xs">{service.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={active ? 'rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-600' : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'}>
                      {service.active} · {service.sub}
                    </span>
                  </td>
                  <td className="max-w-md truncate px-4 py-2.5 text-muted-foreground" title={service.description}>{service.description || '-'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {active ? (
                        <Button variant="ghost" size="icon-xs" title={t('stop')} aria-label={`${t('stop')} ${service.name}`} disabled={busy} onClick={() => void onControl(service.name, 'stop')}><Square className="h-3.5 w-3.5" /></Button>
                      ) : (
                        <Button variant="ghost" size="icon-xs" title={t('start')} aria-label={`${t('start')} ${service.name}`} disabled={busy} onClick={() => void onControl(service.name, 'start')}><Play className="h-3.5 w-3.5" /></Button>
                      )}
                      <Button variant="ghost" size="icon-xs" title={t('restart')} aria-label={`${t('restart')} ${service.name}`} disabled={busy} onClick={() => void onControl(service.name, 'restart')}><RotateCcw className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
