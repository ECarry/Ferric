import { useMemo, useState } from 'react'
import { usePerformanceSnapshot } from '@/hooks/usePerformance'
import { Activity, Cpu, HardDrive, Loader2, MemoryStick, Network, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { formatAppError } from '@/lib/error'
import type { SshConnectConfig } from '@/lib/ssh'

type ResourceId = string

function formatUptime(sec: number) {
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor((sec / 3600) % 24)
  const d = Math.floor(sec / 86400)
  return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatKb(kb: number) {
  if (kb > 1048576) return `${(kb / 1048576).toFixed(1)} GB`
  if (kb > 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb.toFixed(0)} KB`
}

function Sparkline({ data, max: maxProp, className }: { data: number[]; max?: number; className?: string }) {
  const max = maxProp ?? Math.max(1, ...data)
  const width = 100
  const height = 100
  const points = useMemo(() => {
    return data
      .map((v, i) => {
        const x = data.length === 1 ? 0 : (i / (data.length - 1)) * width
        const y = height - (v / max) * height
        return `${x},${y}`
      })
      .join(' ')
  }, [data, max])

  return (
    <svg className={cn('h-full w-full', className)} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        points={points}
      />
    </svg>
  )
}

interface ResourceItemProps {
  id: ResourceId
  name: string
  icon: React.ReactNode
  value: string
  detail?: string
  active: boolean
  onClick: () => void
  data: number[]
  colorClass: string
  max?: number
}

function ResourceItem({ name, icon, value, detail, active, onClick, data, colorClass, max }: ResourceItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-w-[270px] flex w-full items-center gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-w-0',
        active ? 'bg-muted shadow-sm' : 'hover:bg-muted/70',
      )}
    >
      <span className={cn('shrink-0', colorClass)}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium leading-tight">{name}</span>
        <span className="truncate text-[11px] leading-tight text-muted-foreground">{value}</span>
        {detail && <span className="truncate text-[11px] leading-tight text-muted-foreground">{detail}</span>}
      </div>
      <div className="h-[50px] w-[72px] shrink-0 rounded border border-current/40 bg-background/50 p-1">
        <Sparkline data={data} max={max} className={colorClass} />
      </div>
    </button>
  )
}

function MiniGraph({ label, data, colorClass }: { label: string; data: number[]; colorClass: string }) {
  return (
    <div className="flex w-full flex-col gap-1 rounded border border-border bg-card/50 p-2 pb-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="min-h-0 flex-1 w-full">
        <Sparkline data={data} max={100} className={colorClass} />
      </div>
    </div>
  )
}

interface PerformanceViewProps {
  sshConfig: SshConnectConfig
  active?: boolean
}

export function PerformanceView({ sshConfig, active = true }: PerformanceViewProps) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<ResourceId>('cpu')
  const performanceQuery = usePerformanceSnapshot(sshConfig, active)
  const snapshot = performanceQuery.data ?? null
  const { cpu: cpuHistory, memory: memoryHistory, network: networkHistory, cpuCores, diskAvailable: diskAvailableHistory } = performanceQuery.history
  const loading = performanceQuery.isLoading
  const [isRefreshing, setIsRefreshing] = useState(false)
  const error = performanceQuery.error ? formatAppError(performanceQuery.error, t) : null

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await performanceQuery.refetch()
    } finally {
      setIsRefreshing(false)
    }
  }

  const cpuUtil = snapshot?.cpu.utilization ?? 0
  const processes = snapshot?.cpu.processes ?? 0
  const logical = snapshot?.cpu.logicalProcessors ?? 0
  const memory = snapshot?.memory.percent ?? 0
  const network = (snapshot?.network ?? []).reduce((a, n) => a + n.rxKb + n.txKb, 0)
  const uptime = snapshot?.uptime ?? 0

  const selectedDisk = useMemo(() => snapshot?.disk?.find((d) => d.name === selected), [snapshot, selected])

  const resources: ResourceItemProps[] = useMemo(
    () => [
      {
        id: 'cpu',
        name: t('cpu'),
        icon: <Cpu className="h-5 w-5" />,
        value: `${cpuUtil.toFixed(1)}% ${t('utilization').toLowerCase()}`,
        detail: `${logical} ${t('logicalProcessors')}`,
        active: selected === 'cpu',
        onClick: () => setSelected('cpu'),
        data: cpuHistory,
        colorClass: 'text-cyan-400',
        max: 100,
      },
      {
        id: 'memory',
        name: t('memory'),
        icon: <MemoryStick className="h-5 w-5" />,
        value: snapshot ? `${memory.toFixed(1)}% ${t('utilization').toLowerCase()}` : t('usageUnavailable'),
        detail: snapshot ? formatKb(snapshot.memory.usedKb) : t('unavailable'),
        active: selected === 'memory',
        onClick: () => setSelected('memory'),
        data: memoryHistory,
        colorClass: 'text-violet-400',
        max: 100,
      },
      ...(snapshot?.disk ?? []).map((d) => ({
        id: d.name,
        name: d.name,
        icon: <HardDrive className="h-5 w-5" />,
        value: `${d.percent.toFixed(1)}% ${t('utilization').toLowerCase()}`,
        detail: formatKb(d.availableKb) + ' ' + t('available').toLowerCase(),
        active: selected === d.name,
        onClick: () => setSelected(d.name),
        data: diskAvailableHistory[d.name] ?? [],
        colorClass: 'text-green-400',
      })),
      {
        id: 'network',
        name: t('network'),
        icon: <Network className="h-5 w-5" />,
        value: network === 0 ? t('zeroKbps') : `${network.toFixed(1)} KB/s`,
        detail: `${snapshot?.network.length ?? 0} ${t('networkInterfaces')}`,
        active: selected === 'network',
        onClick: () => setSelected('network'),
        data: networkHistory,
        colorClass: 'text-rose-400',
      },
    ],
    [selected, t, cpuUtil, memory, logical, network, snapshot, cpuHistory, memoryHistory, networkHistory, diskAvailableHistory],
  )

  const renderMain = () => {
    if (loading && !snapshot) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">{t('loadingPerformance')}</span>
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
          <Activity className="h-8 w-8 text-destructive/70" />
          <p className="max-w-md break-words text-sm text-destructive" role="alert">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={isRefreshing}>
            {isRefreshing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('retry')}
          </Button>
        </div>
      )
    }

    if (selected === 'cpu') {
      return (
        <>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h3 className="text-3xl font-semibold">{t('cpu')}</h3>
              <p className="text-sm text-muted-foreground">{logical} {t('logicalProcessors')}</p>
            </div>
            <div className="text-4xl font-semibold text-cyan-400">{cpuUtil.toFixed(1)}%</div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {cpuCores.map((data, i) => (
              <MiniGraph key={i} label={`CPU ${i}`} data={data} colorClass="text-cyan-400" />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 md:grid-cols-5">
            <div>
              <div className="text-xs text-muted-foreground">{t('utilization')}</div>
              <div className="font-semibold">{cpuUtil.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('processes')}</div>
              <div className="font-semibold">{processes.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('logicalProcessors')}</div>
              <div className="font-semibold">{logical}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('uptime')}</div>
              <div className="font-semibold">{formatUptime(uptime)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('duration')}</div>
              <div className="font-semibold">{t('seconds60')}</div>
            </div>
          </div>
        </>
      )
    }

    if (selected === 'memory' && snapshot) {
      return (
        <div className="space-y-4">
          <div className="flex items-end justify-between">
            <h3 className="text-3xl font-semibold">{t('memory')}</h3>
            <div className="text-4xl font-semibold text-violet-400">{memory.toFixed(1)}%</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded border border-border p-4">
              <div className="text-xs text-muted-foreground">{t('total')}</div>
              <div className="text-lg font-semibold">{formatKb(snapshot.memory.totalKb)}</div>
            </div>
            <div className="rounded border border-border p-4">
              <div className="text-xs text-muted-foreground">{t('used')}</div>
              <div className="text-lg font-semibold">{formatKb(snapshot.memory.usedKb)}</div>
            </div>
            <div className="rounded border border-border p-4">
              <div className="text-xs text-muted-foreground">{t('free')}</div>
              <div className="text-lg font-semibold">{formatKb(snapshot.memory.freeKb)}</div>
            </div>
          </div>
        </div>
      )
    }

    if (selectedDisk) {
      const data = diskAvailableHistory[selectedDisk.name] ?? []
      return (
        <div className="space-y-4">
          <div className="flex items-end justify-between">
            <h3 className="truncate text-3xl font-semibold">{selectedDisk.name}</h3>
            <div className="text-4xl font-semibold text-green-400">{selectedDisk.percent.toFixed(1)}%</div>
          </div>
          <div className="h-40 w-full rounded border border-border p-3">
            <Sparkline data={data} className="text-green-400" />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-border p-3">
              <div className="text-xs text-muted-foreground">{t('capacity')}</div>
              <div className="font-semibold">{formatKb(selectedDisk.totalKb)}</div>
            </div>
            <div className="rounded border border-border p-3">
              <div className="text-xs text-muted-foreground">{t('available')}</div>
              <div className="font-semibold">{formatKb(selectedDisk.availableKb)}</div>
            </div>
          </div>
        </div>
      )
    }

    if (selected === 'network' && snapshot) {
      return (
        <div className="space-y-4">
          <h3 className="text-3xl font-semibold">{t('network')}</h3>
          <div className="flex flex-col gap-2">
            {snapshot.network.length === 0 ? (
              <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {t('noNetworkInterfaces')}
              </div>
            ) : snapshot.network.map((n) => (
              <div key={n.name} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-3">
                <span className="font-mono text-sm">{n.name}</span>
                <div className="text-sm">
                  <span className="text-green-400">↓ {n.rxKb.toFixed(1)} KB/s</span>
                  <span className="mx-2 text-muted-foreground">/</span>
                  <span className="text-rose-400">↑ {n.txKb.toFixed(1)} KB/s</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <Activity className="h-8 w-8" />
        <span>{t('notConnected')}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-lg font-semibold">{t('performance')}</h2>
          {snapshot && <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-600" role="status">{t('live')}</span>}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing} aria-busy={isRefreshing}>
          <RefreshCw className={cn('mr-1.5 h-4 w-4', isRefreshing && 'animate-spin')} />
          {t('refresh')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="w-full shrink-0 overflow-x-auto border-b border-border p-3 md:w-80 md:overflow-y-auto md:overflow-x-hidden md:border-r md:border-b-0">
          <div className="flex min-w-max flex-row gap-2 md:min-w-0 md:flex-col">
            {resources.map((r) => (
              <ResourceItem key={r.id} {...r} />
            ))}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">{renderMain()}</main>
      </div>
    </div>
  )
}
